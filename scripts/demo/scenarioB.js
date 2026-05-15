const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const PAYMENT_AMOUNT = hre.ethers.parseEther("0.005");

function loadDeployment(networkName) {
  const deploymentPath = path.join(__dirname, "..", "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(deploymentPath)) {
    console.error(`Missing deployment file: ${deploymentPath}`);
    console.error(`Run: npx hardhat run scripts/deploy.js --network ${networkName}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

function formatEth(value) {
  return hre.ethers.formatEther(value);
}

async function ensureFunded(vault, funder) {
  const balance = await hre.ethers.provider.getBalance(await vault.getAddress());
  if (balance < hre.ethers.parseEther("0.01")) {
    console.log("Vault balance is low. Funding vault with 1 ETH.");
    await (await funder.sendTransaction({ to: await vault.getAddress(), value: hre.ethers.parseEther("1") })).wait();
  }
}

async function ensureAuthorized(vault, agent, stakeholder1, stakeholder2) {
  const profile = await vault.getAgentProfile(agent.address);
  if (profile.authorized) {
    console.log("Agent is already authorized. Skipping multisig authorization.");
    return;
  }

  console.log("Authorizing agent via stakeholder multisig.");
  const tx = await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
  const receipt = await tx.wait();
  const proposalEvent = receipt.logs
    .map((log) => {
      try {
        return vault.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event && event.name === "ProposalCreated");
  await (await vault.connect(stakeholder2).approveProposal(proposalEvent.args.proposalId)).wait();
  console.log(`Agent authorized through proposal ${proposalEvent.args.proposalId}.`);
}

async function main() {
  const networkName = hre.network.name;
  if (networkName !== "localhost") {
    console.error("Demo scripts are designed for localhost because they use local-chain assumptions.");
    process.exit(1);
  }

  const deployment = loadDeployment(networkName);
  const [stakeholder1, stakeholder2, stakeholder3, agent, recipient, outsider] = await hre.ethers.getSigners();
  const vault = await hre.ethers.getContractAt("AgentVault", deployment.address);

  console.log("=== Scenario B: Stakeholder Veto ===");
  await ensureFunded(vault, stakeholder1);
  await ensureAuthorized(vault, agent, stakeholder1, stakeholder2);

  const profileBefore = await vault.getAgentProfile(agent.address);
  const vaultBefore = await hre.ethers.provider.getBalance(deployment.address);
  const recipientBefore = await hre.ethers.provider.getBalance(recipient.address);

  console.log("Step 1: Agent submits a payment request for 0.005 ETH.");
  await (await vault.connect(agent).submit(recipient.address, PAYMENT_AMOUNT, hre.ethers.id(`demo-b-${Date.now()}`))).wait();
  const requestId = (await vault.requestCount()) - 1n;
  console.log(`Request ${requestId} is pending inside the challenge window.`);

  console.log("Step 2: Stakeholder3 vetoes the request before execution.");
  await (await vault.connect(stakeholder3).veto(requestId)).wait();

  const request = await vault.getRequest(requestId);
  const profileAfter = await vault.getAgentProfile(agent.address);
  console.log(`Request status: ${request.status} (2 means Vetoed).`);
  console.log(`Vetoed by: ${request.vetoedBy}`);
  console.log(`Agent reputation: ${profileBefore.reputation} -> ${profileAfter.reputation}`);
  console.log(`Agent vetoCount: ${profileBefore.vetoCount} -> ${profileAfter.vetoCount}`);
  console.log(`Vault balance delta: ${formatEth((await hre.ethers.provider.getBalance(deployment.address)) - vaultBefore)} ETH`);
  console.log(`Recipient balance delta: ${formatEth((await hre.ethers.provider.getBalance(recipient.address)) - recipientBefore)} ETH`);

  console.log("Step 3: Attempting to execute the vetoed request.");
  try {
    await vault.connect(outsider).execute(requestId);
    console.log("Unexpected: execution succeeded.");
  } catch {
    console.log("Execution blocked: RequestNotPending.");
  }
  console.log("Scenario B complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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

async function increaseTime(seconds) {
  await hre.ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await hre.ethers.provider.send("evm_mine", []);
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
  const proposalId = proposalEvent.args.proposalId;
  await (await vault.connect(stakeholder2).approveProposal(proposalId)).wait();
  console.log(`Agent authorized through proposal ${proposalId}.`);
}

async function main() {
  const networkName = hre.network.name;
  if (networkName !== "localhost") {
    console.error("Demo scripts are designed for localhost because they use evm_increaseTime.");
    process.exit(1);
  }

  const deployment = loadDeployment(networkName);
  const [stakeholder1, stakeholder2, , agent, recipient, outsider] = await hre.ethers.getSigners();
  const vault = await hre.ethers.getContractAt("AgentVault", deployment.address);

  console.log("=== Scenario A: Optimistic Execution ===");
  await ensureFunded(vault, stakeholder1);
  await ensureAuthorized(vault, agent, stakeholder1, stakeholder2);

  const profileBefore = await vault.getAgentProfile(agent.address);
  const windowBefore = await vault.currentWindow(agent.address);
  const limitBefore = await vault.currentLimit(agent.address);
  const recipientBefore = await hre.ethers.provider.getBalance(recipient.address);
  const vaultBefore = await hre.ethers.provider.getBalance(deployment.address);

  console.log("Step 1: Agent submits a payment request for 0.005 ETH to Alice.");
  console.log(`  -> Reputation: ${profileBefore.reputation}, Window: ${windowBefore}s, Limit: ${formatEth(limitBefore)} ETH`);
  const submitTx = await vault.connect(agent).submit(recipient.address, PAYMENT_AMOUNT, hre.ethers.id(`demo-a-${Date.now()}`));
  const submitReceipt = await submitTx.wait();
  const requestId = (await vault.requestCount()) - 1n;
  const request = await vault.getRequest(requestId);
  console.log(`Agent submitted request ${requestId}, executableAt = ${request.executableAt}.`);
  console.log(`Submit tx: ${submitReceipt.hash}`);

  console.log("Step 2: Time advances past the challenge window.");
  await increaseTime(windowBefore + 1n);
  console.log("Time advanced past challenge window.");

  console.log("Step 3: Anyone can call execute. Outsider triggered execution.");
  await (await vault.connect(outsider).execute(requestId)).wait();

  const profileAfter = await vault.getAgentProfile(agent.address);
  const recipientAfter = await hre.ethers.provider.getBalance(recipient.address);
  const vaultAfter = await hre.ethers.provider.getBalance(deployment.address);
  console.log(`Agent reputation: ${profileBefore.reputation} -> ${profileAfter.reputation}`);
  console.log(`Agent successCount: ${profileBefore.successCount} -> ${profileAfter.successCount}`);
  console.log(`Recipient balance delta: ${formatEth(recipientAfter - recipientBefore)} ETH`);
  console.log(`Vault balance delta: ${formatEth(vaultAfter - vaultBefore)} ETH`);
  console.log("Scenario A complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

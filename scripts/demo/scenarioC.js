const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const SMALL_PAYMENT = hre.ethers.parseEther("0.005");

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
  if (balance < hre.ethers.parseEther("1")) {
    console.log("Funding vault with 1 ETH for repeated scenario executions.");
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

async function submitWaitExecute(vault, agent, recipient, outsider, amount, label) {
  const requestId = await vault.requestCount();
  await (await vault.connect(agent).submit(recipient.address, amount, hre.ethers.id(label))).wait();
  const window = await vault.currentWindow(agent.address);
  await increaseTime(window + 1n);
  await (await vault.connect(outsider).execute(requestId)).wait();
  return requestId;
}

async function main() {
  const networkName = hre.network.name;
  if (networkName !== "localhost") {
    console.error("Demo scripts are designed for localhost because they use evm_increaseTime.");
    process.exit(1);
  }

  const deployment = loadDeployment(networkName);
  const [stakeholder1, stakeholder2, stakeholder3, agent, recipient, outsider] = await hre.ethers.getSigners();
  const vault = await hre.ethers.getContractAt("AgentVault", deployment.address);

  console.log("=== Scenario C: Reputation-Driven Dynamic Parameters ===");
  await ensureFunded(vault, stakeholder1);
  await ensureAuthorized(vault, agent, stakeholder1, stakeholder2);

  let profile = await vault.getAgentProfile(agent.address);
  console.log(`Initial state: rep=${profile.reputation}, window=${await vault.currentWindow(agent.address)}s, limit=${formatEth(await vault.currentLimit(agent.address))} ETH`);

  let round = 1;
  while (round <= 5 || (await vault.getAgentProfile(agent.address)).reputation < 5) {
    const before = await vault.getAgentProfile(agent.address);
    const window = await vault.currentWindow(agent.address);
    const limit = await vault.currentLimit(agent.address);
    console.log(`Round ${round}: rep=${before.reputation}, window=${window}s, limit=${formatEth(limit)} ETH`);
    await submitWaitExecute(vault, agent, recipient, outsider, SMALL_PAYMENT, `demo-c-success-${Date.now()}-${round}`);
    round++;
  }

  profile = await vault.getAgentProfile(agent.address);
  console.log(`After reputation-building successes: rep=${profile.reputation}, window=${await vault.currentWindow(agent.address)}s, limit=${formatEth(await vault.currentLimit(agent.address))} ETH`);

  console.log("Submitting 0.05 ETH within the improved limit.");
  const withinLimitId = await vault.requestCount();
  await (await vault.connect(agent).submit(recipient.address, hre.ethers.parseEther("0.05"), hre.ethers.id(`demo-c-within-${Date.now()}`))).wait();
  console.log(`Within new limit, submitted OK as request ${withinLimitId}.`);
  await increaseTime((await vault.currentWindow(agent.address)) + 1n);
  await (await vault.connect(outsider).execute(withinLimitId)).wait();
  console.log("The 0.05 ETH request executed successfully.");

  const currentLimit = await vault.currentLimit(agent.address);
  const overLimitAmount = currentLimit + hre.ethers.parseEther("0.001");
  console.log(`Submitting ${formatEth(overLimitAmount)} ETH above the current ${formatEth(currentLimit)} ETH limit.`);
  try {
    await vault.connect(agent).submit(recipient.address, overLimitAmount, hre.ethers.id(`demo-c-over-${Date.now()}`));
    console.log("Unexpected: over-limit request succeeded.");
  } catch {
    console.log("Exceeds limit: AmountExceedsLimit.");
  }

  console.log("Submitting one more small request so a stakeholder can veto it.");
  const vetoId = await vault.requestCount();
  const beforeVeto = await vault.getAgentProfile(agent.address);
  await (await vault.connect(agent).submit(recipient.address, SMALL_PAYMENT, hre.ethers.id(`demo-c-veto-${Date.now()}`))).wait();
  await (await vault.connect(stakeholder3).veto(vetoId)).wait();
  const afterVeto = await vault.getAgentProfile(agent.address);
  console.log(`Reputation after veto: ${beforeVeto.reputation} -> ${afterVeto.reputation}`);
  console.log(`New window=${await vault.currentWindow(agent.address)}s, new limit=${formatEth(await vault.currentLimit(agent.address))} ETH`);
  console.log("Scenario C complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

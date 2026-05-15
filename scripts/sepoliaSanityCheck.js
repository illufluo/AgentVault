const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const EXPECTED_BASE_WINDOW = 3600n;
const EXPECTED_BASE_LIMIT = hre.ethers.parseEther("0.01");

function loadSepoliaDeployment() {
  const deploymentPath = path.join(__dirname, "..", "deployments", "sepolia.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Missing deployment file: ${deploymentPath}. Run npm run deploy:sepolia first.`);
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message, details) {
  console.log(`FAIL ${message}`);
  if (details) {
    console.log(`     ${details}`);
  }
}

async function main() {
  if (hre.network.name !== "sepolia") {
    throw new Error("This sanity check must be run with --network sepolia");
  }

  const deployment = loadSepoliaDeployment();
  const vault = await hre.ethers.getContractAt("AgentVault", deployment.address);

  console.log("=== AgentVault Sepolia Sanity Check ===");
  console.log(`Vault: ${deployment.address}`);
  console.log(`Expected stakeholders: ${deployment.stakeholders.length}`);

  let failures = 0;

  const stakeholders = await vault.getStakeholders();
  if (stakeholders.length === deployment.stakeholders.length) {
    pass(`getStakeholders length == ${deployment.stakeholders.length}`);
  } else {
    failures++;
    fail(
      "getStakeholders length mismatch",
      `on-chain=${stakeholders.length}, deployment=${deployment.stakeholders.length}`
    );
  }

  const zeroWindow = await vault.currentWindow(hre.ethers.ZeroAddress);
  if (zeroWindow === EXPECTED_BASE_WINDOW) {
    pass("currentWindow(zero address) == 3600");
  } else {
    failures++;
    fail("currentWindow(zero address) mismatch", `actual=${zeroWindow}, expected=${EXPECTED_BASE_WINDOW}`);
  }

  const zeroLimit = await vault.currentLimit(hre.ethers.ZeroAddress);
  if (zeroLimit === EXPECTED_BASE_LIMIT) {
    pass("currentLimit(zero address) == 0.01 ether");
  } else {
    failures++;
    fail(
      "currentLimit(zero address) mismatch",
      `actual=${hre.ethers.formatEther(zeroLimit)} ETH, expected=0.01 ETH`
    );
  }

  console.log("Manual checks still required: authorize, submit, veto, and execute.");
  console.log("Please run the remaining checks manually on Remix (see docs/SEPOLIA_GUIDE.md).");

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

# Sepolia Deployment & Verification Guide

## Prerequisites

- Node 18+; this project tolerates Node v25 with Hardhat warnings.
- Sepolia ETH >= 0.05 ETH for deployment, verification transactions, and manual testing.
- Sepolia faucets: Alchemy Sepolia faucet, pk910 Sepolia faucet.
- Infura or Alchemy Sepolia RPC URL.
- Etherscan API key.
- Three Sepolia accounts to serve as stakeholders.
- For a fast course demo, you may use the deployer-controlled accounts as all stakeholders if you control their private keys. This is easier to demo but weaker as a governance story; the stronger presentation uses three separate accounts.

## Setup

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Fill in:

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<KEY>
PRIVATE_KEY=0x<deployer-private-key>
ETHERSCAN_API_KEY=<key>
STAKEHOLDERS=0xAAA,0xBBB,0xCCC
THRESHOLD=2
REPORT_GAS=false
```

Notes:

- `STAKEHOLDERS` is optional. If omitted, the deploy script uses the first three signers available to Hardhat.
- `THRESHOLD` is optional and defaults to `2`.
- Keep `.env` in `.gitignore`.
- Never commit private keys.

## Deploy

Run:

```bash
npm run deploy:sepolia
```

Expected output includes:

- network name
- deployer address
- stakeholder addresses
- threshold
- deployment transaction hash
- deployed contract address
- block number
- gas used
- `deployments/sepolia.json` path
- `deployments/sepolia-args.js` path
- Etherscan verify command

The deployment JSON format is:

```json
{
  "address": "0x...",
  "stakeholders": ["0x...", "0x...", "0x..."],
  "threshold": 2,
  "deployedAt": 1778690554,
  "deployer": "0x..."
}
```

## Verify on Etherscan

Copy the verify command printed by the deploy script:

```bash
npx hardhat verify --network sepolia <ADDRESS> --constructor-args deployments/sepolia-args.js
```

On success, the Etherscan contract page will show a "Contract Source Code Verified" badge. Capture a screenshot showing:

- the verified badge
- the contract address
- the compiler version `0.8.24`
- optimizer enabled with 200 runs

## Sanity Check (automated view functions)

Run:

```bash
npm run verify:sepolia
```

This checks the view-only items that do not require waiting:

- `getStakeholders()` length matches `deployments/sepolia.json`
- `currentWindow(0x0000000000000000000000000000000000000000) == 3600`
- `currentLimit(0x0000000000000000000000000000000000000000) == 0.01 ether`

The script prints `PASS` or `FAIL` for each item.

## Manual Testing on Remix (the critical part)

### Step 1: Connect Remix to deployed contract

- Go to `https://remix.ethereum.org`.
- Open the "Deploy & Run Transactions" tab.
- Set Environment to "Injected Provider - MetaMask".
- Switch MetaMask to Sepolia.
- Compile or load the `AgentVault` ABI.
- Paste the deployed contract address in the "At Address" field.
- Click "At Address". The deployed contract interface appears.

### Step 2: Verify initial state

Call:

- `getStakeholders()` -> should return the 3 addresses you configured.
- `threshold()` -> should return `2`.

Checkpoint 1 passed.

### Step 3: Authorize an Agent

Two stakeholders are required.

- Switch MetaMask to stakeholder1.
- Call `proposeAuthorizeAgent(<agent_address>)`.
- Record the returned `proposalId`; it is also visible in event logs.
- Switch MetaMask to stakeholder2.
- Call `approveProposal(<proposalId>)`.
- Call `getAgentProfile(<agent_address>)`.
- Expected result: `authorized: true`, `reputation: 0`, `successCount: 0`, `vetoCount: 0`.

Checkpoint 2 passed.

### Step 4: Agent submits a request

- Switch MetaMask to the agent account.
- First, fund the vault: send `0.05 ETH` directly to the vault address. This triggers `receive()` and emits `Deposit`.
- Call:

```text
submit(<recipient_address>, 5000000000000000, 0x1111111111111111111111111111111111111111111111111111111111111111)
```

`5000000000000000 wei = 0.005 ETH`.

- Record the returned `requestId`.
- Call `getRequest(<requestId>)` -> `status` should be `0` (`Pending`).
- Call `currentWindow(<agent_address>)` -> should return `3600`.

Checkpoint 3 passed.

### Step 5: Stakeholder vetoes

- Switch MetaMask to stakeholder3.
- Call `veto(<requestId>)`.
- Call `getRequest(<requestId>)`.
- Expected result: `status: 2` (`Vetoed`), `vetoedBy = stakeholder3`.
- Call `getAgentProfile(<agent_address>)`.
- Expected result: `reputation: -3`, `vetoCount: 1`.

Checkpoint 4 passed.

### Step 6: Test execution

This requires waiting 1 hour because `BASE_WINDOW = 3600s` on Sepolia.

- Switch to the agent account.
- Submit another request:

```text
submit(<recipient_address>, 5000000000000000, 0x2222222222222222222222222222222222222222222222222222222222222222)
```

- Record the new `requestId`.
- Wait 1 hour.
- Optional: while waiting, screenshot Etherscan event logs as proof.
- After 1 hour, switch to any account. `execute` is permissionless.
- Call `execute(<requestId>)`.
- Call `getRequest(<requestId>)` -> `status: 1` (`Executed`).
- Call `getAgentProfile(<agent_address>)` -> reputation should be `-2` if it was `-3` before, and `successCount: 1`.

Checkpoint 5 passed.

### Step 7: Inspect events on Etherscan

Open:

```text
https://sepolia.etherscan.io/address/<VAULT_ADDRESS>#events
```

You should see a chronological log containing:

- `Deposit`
- `ProposalCreated`
- `ProposalApproved`
- `AgentAuthorized`
- `ProposalExecuted`
- `PaymentRequested`
- `PaymentVetoed`
- `ReputationChanged`
- `PaymentExecuted`

Each event has indexed fields that can be filtered on Etherscan. Use this in the course report to demonstrate auditability.

## Troubleshooting

- `insufficient funds for gas`: fund the deployer and stakeholder accounts with more Sepolia ETH.
- `nonce too high`: reset the MetaMask account from Advanced settings.
- Etherscan verify fails: confirm Solidity version `0.8.24`, optimizer enabled, 200 runs, and `evmVersion: "paris"` match `hardhat.config.js`.
- Verify command cannot parse constructor arguments: use the generated `deployments/sepolia-args.js`.
- Long waits: `BASE_WINDOW` is `3600s`, so plan the execution demo at least 1 hour ahead.
- Wrong stakeholder account in Remix: switch MetaMask to one of the stakeholder addresses in `deployments/sepolia.json`.

# AgentVault

A smart contract wallet for AI Agents. The contract is the Agent's source of authorization and a public notary of its behavior — Agents request payments, Stakeholders can veto, reputation evolves over time.

**Deployed on Sepolia:** [`0xA845d6F05BC712A497Bb1dE6FAD170758A7351fA`](https://sepolia.etherscan.io/address/0xA845d6F05BC712A497Bb1dE6FAD170758A7351fA#code) (verified)

## Core Mechanics

- **Optimistic execution with single-stakeholder veto** — Agents submit payment requests; any one stakeholder can veto within a challenge window; otherwise the payment executes optimistically.
- **Reputation-driven dynamic parameters** — Successful executions raise the Agent's reputation (+1); vetoes lower it (−3). Reputation governs both the challenge window length and the per-payment limit.
- **Multi-sig governance via on-chain proposals** — Authorizing/revoking Agents and managing Stakeholders requires N-of-M approval.
- **Full on-chain audit log** — Every action emits indexed events for permanent accountability.

## Tech Stack

Solidity 0.8.24 · Hardhat · OpenZeppelin 5.0 · ethers.js v6

## Quick Start

```bash
npm install --legacy-peer-deps
cp .env.example .env       # fill in for Sepolia
npm test                   # 75 tests passing
npm run deploy:sepolia     # deploy to testnet
```

For local demonstration:

```bash
npm run node               # in one terminal
npm run deploy:local       # in another
npm run demo:a             # optimistic execution
npm run demo:b             # stakeholder veto
npm run demo:c             # reputation-driven dynamics
```


## Project Structure

```
contracts/      Solidity contracts (AgentVault + library + test helpers)
test/           Unit and integration test suites (75 tests)
scripts/        Deployment and demo scripts
deployments/    Deployed contract records (per network)
```

## Security

- ReentrancyGuard on `execute()`
- Strict checks-effects-interactions ordering
- Custom errors throughout
- No `unchecked`, no `tx.origin`, no `delegatecall`
- Challenge window frozen at submission to prevent timing attacks
- Failed-state handling preserves vault funds when recipients revert

# How to Test AgentVault

There are two ways to verify the contract. Pick whichever is easier.

## Option 1: Just look at the deployed contract

I deployed and verified the contract on Sepolia:

- Contract: `0xA845d6F05BC712A497Bb1dE6FAD170758A7351fA`
- Source code (verified): https://sepolia.etherscan.io/address/0xA845d6F05BC712A497Bb1dE6FAD170758A7351fA#code
- All events from my own testing: https://sepolia.etherscan.io/address/0xA845d6F05BC712A497Bb1dE6FAD170758A7351fA#events

The Events page shows everything in order — stakeholders proposing, agent getting authorized, deposit, two payment requests, a veto, and the reputation drop from 0 to −3.

To call view functions (free, no wallet needed), open the Etherscan page above and use the **Read Contract** tab. For example:

- `getStakeholders()` → returns the three stakeholders
- `threshold()` → returns 2
- `getAgentProfile(0xd7c8a50aebd7d95273a2e98fa8c1b28caac5d428)` → shows the test agent has reputation −3 and vetoCount 1
- `currentWindow(<any address>)` → returns 3600 for a fresh agent
- `currentLimit(<any address>)` → returns 0.01 ETH for a fresh agent

## Option 2: Deploy your own copy in Remix

You'll need MetaMask with 4 Sepolia accounts and a bit of Sepolia ETH in each.

**Step 1.** Open https://remix.ethereum.org. In the `contracts/` folder, create two files and paste the source code from my submission:
- `ReputationMath.sol`
- `AgentVault.sol`

**Step 2.** In `AgentVault.sol`, change this line:

```solidity
import "./libraries/ReputationMath.sol";
```

to:

```solidity
import "./ReputationMath.sol";
```

(Remix doesn't keep the subfolder structure from the original project, so the import path needs adjusting.)

**Step 3.** Compile `AgentVault.sol` with Solidity 0.8.24.

**Step 4.** In the Deploy tab, switch Environment to **Injected Provider - MetaMask**, select the AgentVault contract, and deploy with these constructor arguments:

- `_stakeholders`: `["0xAddress1","0xAddress2","0xAddress3"]` (three of your addresses)
- `_threshold`: `2`

**Step 5.** Test the core flow:

1. From Stakeholder1, call `proposeAuthorizeAgent(<agent address>)`
2. From Stakeholder2, call `approveProposal(0)` — this triggers automatic execution and emits `AgentAuthorized`
3. Send ~0.05 ETH directly to the contract address (this triggers `receive()` and emits `Deposit`)
4. From the agent account, call `submit(<recipient>, 5000000000000000, 0x0000...0001)`. This is a 0.005 ETH payment with a dummy intent hash.
5. From Stakeholder3, call `veto(0)`. The agent's reputation should drop to −3.
6. Check `getAgentProfile(<agent address>)` — reputation should be −3, vetoCount should be 1.

To verify the optimistic execution path, submit another request and wait one hour (the default challenge window), then call `execute(<requestId>)` from any account. Reputation goes up by 1.

## Optional: run the Hardhat tests

```bash
npm install --legacy-peer-deps
npm test
```

75 tests should pass.

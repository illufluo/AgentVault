# AgentVault — Project Constitution

This file is the source of truth for the AgentVault smart contract project. Read this completely before any code action. When in doubt, re-read this. Do not deviate from these rules without explicit instruction from the user in the active prompt.

---

## 1. What This Project Is

AgentVault is a smart contract wallet designed for AI Agents. The contract holds funds; an authorized AI Agent (EOA) submits payment requests; Stakeholders can single-handedly veto requests within a challenge window; if not vetoed, the request executes optimistically. The Agent accrues on-chain reputation based on past behavior, and reputation dynamically adjusts (a) the challenge window length and (b) the per-payment limit.

This is a university blockchain course final project. The judging criteria are equally weighted across: Innovation & Originality, Smart Contract Functionality, Code Quality & Security, Interaction & Usability.

## 2. Stack & Versions (Pin These — Do Not Upgrade Without Asking)

- Solidity: `0.8.24`
- Hardhat: `^2.22.0`
- OpenZeppelin Contracts: `^5.0.0`
- ethers.js: `^6.0.0`
- Node.js: assume Node 18+ available in Docker container
- Networks: local hardhat node for dev/test, Sepolia testnet for final deployment

If npm install hits peer dependency errors, use `--legacy-peer-deps`. Do not switch package managers.

## 3. Project Layout

```
agentvault/
├── contracts/
│   ├── AgentVault.sol              # main contract, single file (see §4)
│   ├── interfaces/
│   │   └── IAgentVault.sol         # external interface
│   └── libraries/
│       └── ReputationMath.sol      # pure functions for reputation math
├── test/
│   ├── unit/
│   │   ├── StakeholderManager.test.js
│   │   ├── AgentRegistry.test.js
│   │   ├── PaymentQueue.test.js
│   │   └── ReputationEngine.test.js
│   └── integration/
│       └── Scenarios.test.js       # scenarios A, B, C end-to-end
├── scripts/
│   ├── deploy.js                   # deploy to any network
│   └── demo/
│       ├── scenarioA.js
│       ├── scenarioB.js
│       └── scenarioC.js
├── hardhat.config.js
├── .env.example                    # SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY
├── README.md
├── REPORT_OUTLINE.md
└── CLAUDE.md                       # this file
```

Keep the main contract in a single file `AgentVault.sol`. Splitting into separate contracts adds deployment complexity and gas overhead for a course project. Logical "modules" are internal sections within the same contract, separated by clear comment banners.

## 4. Architecture: Single Contract, Five Logical Modules

Inside `AgentVault.sol`, use comment banners to separate:

```
// ============================================================
// MODULE 1: STAKEHOLDER MANAGER (multisig governance)
// ============================================================
// ============================================================
// MODULE 2: AGENT REGISTRY (agent authorization state)
// ============================================================
// ============================================================
// MODULE 3: PAYMENT QUEUE (request lifecycle)
// ============================================================
// ============================================================
// MODULE 4: REPUTATION ENGINE (reputation + dynamic params)
// ============================================================
// ============================================================
// MODULE 5: AUDIT LOG (events — defined at contract top)
// ============================================================
```

## 5. Data Model (Authoritative)

### Enums

```solidity
enum ProposalType { AuthorizeAgent, RevokeAgent, AddStakeholder, RemoveStakeholder }
enum ProposalStatus { Pending, Executed, Expired, Cancelled }
enum RequestStatus { Pending, Executed, Vetoed, Failed }
```

### Structs

```solidity
struct Proposal {
    ProposalType pType;
    address target;            // agent address or stakeholder address depending on pType
    address proposer;
    uint64 createdAt;
    uint64 expiresAt;
    ProposalStatus status;
    uint8 approvalCount;
    mapping(address => bool) hasApproved;
}

struct PaymentRequest {
    address agent;
    address payable recipient;
    uint128 amount;
    bytes32 intentHash;
    uint64 submittedAt;
    uint64 executableAt;       // submittedAt + window-at-submission-time; FROZEN at submission
    RequestStatus status;
    address vetoedBy;          // zero address if not vetoed
}

struct AgentProfile {
    bool authorized;
    int32 reputation;
    uint64 authorizedAt;
    uint32 successCount;
    uint32 vetoCount;
}
```

### State Variables

```solidity
address[] public stakeholders;
mapping(address => bool) public isStakeholder;
uint8 public threshold;

mapping(uint256 => Proposal) internal proposals;  // internal because contains nested mapping
uint256 public proposalCount;

mapping(address => AgentProfile) public agents;
mapping(uint256 => PaymentRequest) public requests;
uint256 public requestCount;
```

## 6. Reputation Math (Authoritative — Implement Exactly)

> 注：BASE_WINDOW / MIN_WINDOW / WINDOW_SLOPE 在 Phase 2 调整为更短的实操值，
> 目的是让 Sepolia 真实部署后也可以做现场演示（24h 窗口在测试网无法实操）。

Constants:
```solidity
int32  constant REPUTATION_MIN     = -10;
int32  constant REPUTATION_MAX     = 100;
int32  constant REWARD_PER_SUCCESS = 1;
int32  constant PENALTY_PER_VETO   = 3;

uint64 constant BASE_WINDOW = 3600;   // 1h
uint64 constant MIN_WINDOW  = 300;    // 5m
uint64 constant WINDOW_SLOPE = 30;    // seconds per reputation point

uint128 constant BASE_LIMIT = 0.01 ether;
uint128 constant MAX_LIMIT  = 1 ether;
uint128 constant LIMIT_SLOPE = 0.01 ether;
uint64  constant PROPOSAL_TTL = 7 days;
```

Formulas (put in `ReputationMath.sol` library as pure functions):

```
computeWindow(int32 rep) -> uint64:
    if rep <= 0:
        return BASE_WINDOW + uint64(uint32(-rep)) * WINDOW_SLOPE   // negative rep = longer window
    delta = uint64(uint32(rep)) * WINDOW_SLOPE
    if delta >= BASE_WINDOW - MIN_WINDOW: return MIN_WINDOW
    return BASE_WINDOW - delta

computeLimit(int32 rep) -> uint128:
    if rep < 0:
        return BASE_LIMIT / 2
    delta = uint128(uint32(rep)) * LIMIT_SLOPE
    candidate = BASE_LIMIT + delta
    if candidate > MAX_LIMIT: return MAX_LIMIT
    return candidate
```

Reputation update rules (clamp to [REPUTATION_MIN, REPUTATION_MAX]):
- On successful execution: `rep = min(rep + REWARD_PER_SUCCESS, REPUTATION_MAX)`
- On veto: `rep = max(rep - PENALTY_PER_VETO, REPUTATION_MIN)`
- On Failed (recipient revert): no change

## 7. Payment Request State Machine (Authoritative)

```
                    submit(recipient, amount, intentHash)
                                 │
                                 ▼
                             [Pending]
                    ┌────────────┼─────────────────────┐
            veto    │            │ execute (any caller)│
                    │            │ AND block.timestamp │
                    ▼            │ >= executableAt     │
                [Vetoed]         │                     │
                rep -= 3         ▼                     ▼
                            recipient.call         recipient.call
                            succeeds               reverts
                                 │                     │
                                 ▼                     ▼
                            [Executed]              [Failed]
                            rep += 1                rep unchanged
```

Rules:
1. Only `authorized` Agents can call `submit`. Amount must be ≤ `computeLimit(agentRep)` at submission time, and ≤ contract balance.
2. `executableAt` is `block.timestamp + computeWindow(agentRep)` at submission. Once submitted, the window does NOT recompute based on later reputation changes — it is frozen.
3. Any stakeholder can call `veto(requestId)` while status is Pending, regardless of whether the window has elapsed. (Stakeholders retain veto power until the request is in a terminal state.)
4. `execute(requestId)` is permissionless (any caller — agent, stakeholder, or anyone watching the chain). It requires status == Pending and `block.timestamp >= executableAt`.
5. Use checks-effects-interactions: set status BEFORE the external call. Use `recipient.call{value: amount}("")` and capture both success and returndata. On failure, set status to Failed and emit PaymentFailed with reason bytes.
6. Use OpenZeppelin's `ReentrancyGuard` on `execute`.
7. Failed requests do NOT refund anywhere — funds remain in the contract. Status is terminal.

## 8. Multisig (Authoritative)

Mechanism: on-chain proposal voting.

Rules:
1. Any stakeholder may call `propose<Type>(target)` which creates a Proposal with `proposer` auto-counted as 1 approval.
2. Other stakeholders call `approveProposal(uint256 proposalId)`. The same stakeholder cannot approve twice (revert `ProposalAlreadyApproved`).
3. When `approvalCount` reaches `threshold`, the **last approval auto-triggers execution** within the same transaction. No separate execute function for governance proposals.
4. Proposals expire at `createdAt + PROPOSAL_TTL` (7 days). Expired proposals revert on approval.
5. Stakeholder removal: if removing a stakeholder would cause `stakeholders.length < threshold`, revert. Threshold remains fixed at deployment for v1 — changing threshold is future work.
6. Initial stakeholders and threshold are set in the constructor and immutable after deployment (for v1 — adding/removing stakeholders post-deployment IS supported via proposals, but threshold itself is not modifiable).

## 9. Access Control & Errors

Use custom errors, not `require` with strings:

```solidity
error NotStakeholder();
error NotAgent();
error AgentAlreadyAuthorized();
error AgentNotAuthorized();
error AlreadyStakeholder();
error WouldDropBelowThreshold();
error ProposalNotFound();
error ProposalNotPending();
error ProposalAlreadyApproved();
error ProposalExpired();
error AmountExceedsLimit(uint128 requested, uint128 maxAllowed);
error AmountZero();
error InsufficientBalance(uint256 requested, uint256 available);
error WindowNotElapsed(uint64 currentTime, uint64 executableAt);
error RequestNotPending();
error InvalidRecipient();
error InvalidThreshold();
error EmptyStakeholders();
```

Modifiers:
```solidity
modifier onlyStakeholder()       { if (!isStakeholder[msg.sender]) revert NotStakeholder(); _; }
modifier onlyAuthorizedAgent()   { if (!agents[msg.sender].authorized) revert NotAgent(); _; }
```

## 10. Events (Authoritative — Implement Exactly)

```solidity
event ProposalCreated(uint256 indexed proposalId, ProposalType indexed pType, address indexed target, address proposer);
event ProposalApproved(uint256 indexed proposalId, address indexed approver, uint8 approvalCount);
event ProposalExecuted(uint256 indexed proposalId);
event ProposalExpiredEvent(uint256 indexed proposalId);  // emitted lazily when someone tries to interact with expired

event AgentAuthorized(address indexed agent, uint256 indexed proposalId);
event AgentRevoked(address indexed agent, uint256 indexed proposalId);
event StakeholderAdded(address indexed stakeholder, uint256 indexed proposalId);
event StakeholderRemoved(address indexed stakeholder, uint256 indexed proposalId);

event PaymentRequested(
    uint256 indexed requestId,
    address indexed agent,
    address indexed recipient,
    uint128 amount,
    bytes32 intentHash,
    uint64 executableAt
);
event PaymentVetoed(uint256 indexed requestId, address indexed vetoer);
event PaymentExecuted(uint256 indexed requestId);
event PaymentFailed(uint256 indexed requestId, bytes reason);

event ReputationChanged(address indexed agent, int32 oldReputation, int32 newReputation, string changeType);
// changeType is one of: "SUCCESS", "VETO"

event Deposit(address indexed from, uint256 amount);
```

## 11. Security Requirements (Non-Negotiable)

1. **Reentrancy**: `execute()` uses `nonReentrant` from OpenZeppelin. State transitions happen before the external call.
2. **Integer over/underflow**: Solidity 0.8+ checked arithmetic by default. Do NOT use `unchecked` blocks anywhere.
3. **Access control**: Every state-mutating function has the correct modifier. No "open" functions except `execute()` (permissionless by design) and `receive()` (deposits).
4. **External call result handling**: After `recipient.call{value: amount}("")`, branch on success. Never assume success.
5. **CEI (Checks-Effects-Interactions)**: Status updates and balance bookkeeping happen BEFORE external calls.
6. **No `tx.origin`**: Always use `msg.sender`.
7. **No `selfdestruct`, no `delegatecall`** to untrusted contracts (we don't use either).
8. **Receive function** for direct ETH deposits, emit `Deposit` event.
9. **Frozen `executableAt`**: At submission, store the computed `executableAt` in the request. Later reputation changes do not retroactively shorten/lengthen pending requests' windows.

## 12. Code Style Rules

- NatSpec comments on every external/public function: `@notice`, `@param`, `@return`.
- Order in contract: state vars → events → errors → modifiers → constructor → external → public → internal → private → view/pure.
- Custom errors over `require` strings everywhere.
- No magic numbers — every constant gets a named `constant` declaration.
- Function names: verb first (`proposeAuthorizeAgent`, not `agentAuthorize`).
- Internal helpers prefixed with `_` (`_executePayment`, `_updateReputation`).
- No console.log left in final code.
- Run `npx hardhat compile` — must produce **zero warnings**.

## 13. Testing Standards

- Use Hardhat + Chai + ethers v6.
- Use `loadFixture` for setup.
- Use `time.increase(seconds)` from `@nomicfoundation/hardhat-network-helpers` for time travel.
- Every external/public function has at least one happy-path test and one revert test.
- Edge cases that MUST be tested:
  - Veto a request after window has elapsed but before execute (should succeed — veto wins)
  - Execute attempt before window elapsed (revert WindowNotElapsed)
  - Recipient is a contract that reverts in receive → status becomes Failed, reputation unchanged
  - Reputation clamping at both bounds
  - Removing a stakeholder when it would drop below threshold (revert)
  - Two stakeholders trying to approve same proposal twice (second reverts)
  - Reentrancy attempt via malicious recipient calling back into execute (must be blocked by guard)
- Coverage target: 100% line coverage on AgentVault.sol via `npx hardhat coverage`.
- All tests must pass: `npx hardhat test` returns 0 exit code.

## 14. Definition of Done (Each Phase)

A phase is NOT done unless ALL of these hold:
- `npx hardhat compile` succeeds with zero warnings
- `npx hardhat test` passes 100%
- All new public/external functions have NatSpec
- No `console.log` or commented-out code
- No TODO comments without explanation of why deferred

## 15. What NOT to Do (Hard Constraints)

- Do NOT add features beyond what's in this file without asking the user first.
- Do NOT add reputation decay, intent URI, veto reason hash, emergency freeze, or batch requests — they are future work for v2.
- Do NOT use upgradeable proxy patterns. This is a non-upgradeable v1.
- Do NOT use external oracles, Chainlink, or any off-chain data source.
- Do NOT use assembly unless explicitly justified in a comment and approved by the user.
- Do NOT optimize for gas at the expense of readability. This is a course project graded on code quality.
- Do NOT introduce new dependencies beyond OpenZeppelin and Hardhat tooling.
- Do NOT modify this file. If a constraint here is wrong, ask the user.

## 16. Working Style

When working on a phase:
1. Restate the phase goal in your own words at the start.
2. List files you will create/modify.
3. Implement.
4. Run compile + tests yourself before declaring done.
5. Output a one-paragraph summary: what was done, any decisions made, what's next.

If you encounter ambiguity, STOP and ask. Do not guess at user intent.

# AgentVault 项目进度同步文件

> 本文件用于在 Claude Code（CLI）与网页版 Claude 之间同步项目进度。
> 每次继续开发前，请将此文件发给网页版 Claude，使其了解当前状态。

---

## 项目简介

AgentVault 是一个为 AI Agent 设计的智能合约钱包，核心机制：
- AI Agent（EOA）提交支付请求
- Stakeholder 在挑战窗口内可一票否决
- 超时未否决则乐观执行
- Agent 积累链上声誉，声誉动态调整挑战窗口时长和单笔支付上限

这是一门大学区块链课程的期末项目，评分标准四项等权：创新性、合约功能、代码质量与安全性、交互与可用性。

---

## 技术栈（已锁定版本，不得擅自升级）

| 依赖 | 版本 |
|------|------|
| Solidity | 0.8.24 |
| Hardhat | ^2.22.0（实际安装 ^2.28.6） |
| @nomicfoundation/hardhat-toolbox | hh2 兼容版（^6.1.2） |
| @openzeppelin/contracts | ^5.0.0（实际安装 ^5.6.1） |
| ethers.js | ^6.0.0（实际安装 ^6.16.0） |
| dotenv | 已安装 |

> 如安装遇到 peer dependency 报错，使用 `--legacy-peer-deps`。

---

## 当前完成状态

### ✅ 阶段 0：项目初始化（已完成）

**已完成的工作：**

1. `npm init -y` 完成，`package.json` 已生成
2. 所有依赖已安装（含 hardhat-toolbox 的全部 peer deps）
3. 目录结构已按 CLAUDE.md §3 创建完毕
4. `hardhat.config.js` 已配置（见下方详情）
5. `.env.example` 已创建
6. `.gitignore` 已创建
7. `README.md` 已创建
8. `npx hardhat compile` 验证通过（exit 0，输出 "Nothing to compile"）

**注意事项：**
- Node.js 版本为 v25.2.1，Hardhat 2 官方只支持到 Node 22，会有 WARNING 提示，但实际运行正常，忽略即可。
- hardhat-toolbox 最新版需要 Hardhat 3，必须安装 `hh2` tag：`@nomicfoundation/hardhat-toolbox@hh2`

### ✅ 阶段 1：合约骨架（已完成）

**创建的文件：**

1. `contracts/AgentVault.sol`
2. `contracts/libraries/ReputationMath.sol`
3. `contracts/interfaces/IAgentVault.sol`

**constructor 实现要点：**

1. 空 stakeholder 数组会 revert `EmptyStakeholders()`
2. threshold 为 0 或大于 stakeholder 数量会 revert `InvalidThreshold()`
3. constructor 遍历初始 stakeholder，拒绝 zero address，并复用 `InvalidThreshold()`
4. constructor 使用 `isStakeholder` 检测重复地址，重复会 revert `AlreadyStakeholder()`
5. 初始化时写入 `stakeholders` 数组、`isStakeholder` 映射，并设置固定 `threshold`

**接口与骨架说明：**

- `getProposal` 返回 7 个解包值，而不是返回 `Proposal` struct，因为 `Proposal` 内含 nested mapping `hasApproved`，无法整体作为 external 返回值。
- `hasApproved(uint256 proposalId, address who)` 单独用于查询 proposal 的 approval mapping。
- 除 constructor 和 `receive()` 外，external/view 占位函数均保持 `revert("not implemented");`，等待后续阶段实现业务逻辑。

**Phase 2/3 注意事项：**

- `ReputationMath.sol` 当前只保留函数签名和零值占位，Phase 2 需要严格按 AGENT.md §6 实现常量和公式。
- `AgentVault.sol` 当前仅包含状态、事件、错误、modifier、constructor、receive 和函数签名；治理、支付、声誉更新逻辑尚未实现。
- `execute()` 保留 `nonReentrant`，占位阶段为避免 OpenZeppelin modifier 收尾代码被 Solidity 判定为 unreachable，加入了仅用于编译期可达性判断的 `address(this).code.length == 0` 分支；部署后的正常调用仍会进入 `revert("not implemented");`。
- Phase 3 写测试时需覆盖 AGENT.md §13 列出的 veto、execute、recipient revert、reentrancy、reputation clamp 等边界场景。

### ✅ 阶段 2：ReputationMath 实现（已完成）

**AGENT.md §6 参数调整记录：**

为便于 Sepolia 真实部署后的现场演示，Phase 2 已将挑战窗口参数从 24 小时级别调整为更短的实操值：

| 常量 | 旧值 | 新值 | 含义 |
|------|------|------|------|
| `BASE_WINDOW` | `86400` | `3600` | 基础挑战窗口从 24h 改为 1h |
| `MIN_WINDOW` | `3600` | `300` | 最短挑战窗口从 1h 改为 5m |
| `WINDOW_SLOPE` | `600` | `30` | 每点声誉缩短/延长 30 秒 |

其他常量保持不变：
- `REPUTATION_MIN = -10`
- `REPUTATION_MAX = 100`
- `REWARD_PER_SUCCESS = 1`
- `PENALTY_PER_VETO = 3`
- `BASE_LIMIT = 0.01 ether`
- `MAX_LIMIT = 1 ether`
- `LIMIT_SLOPE = 0.01 ether`
- `PROPOSAL_TTL = 7 days`

**ReputationMath 库实现：**

1. `computeWindow(int32 rep)`：
   - `rep <= 0`：先用 `int64` 中转取绝对值，避免 `int32` 最小值取负溢出，再返回 `BASE_WINDOW + absRep * WINDOW_SLOPE`
   - `rep > 0`：用 `uint64(uint32(rep))` 安全转换后计算 `delta`
   - 当 `delta >= BASE_WINDOW - MIN_WINDOW` 时返回 `MIN_WINDOW`
   - 否则返回 `BASE_WINDOW - delta`

2. `computeLimit(int32 rep)`：
   - `rep < 0`：返回 `BASE_LIMIT / 2`
   - `rep >= 0`：用 `uint128(uint32(rep)) * LIMIT_SLOPE` 计算增量
   - `candidate > MAX_LIMIT` 时返回 `MAX_LIMIT`
   - 否则返回 `candidate`

**PROPOSAL_TTL 放置位置：**

- `PROPOSAL_TTL` 当前放在 `contracts/libraries/ReputationMath.sol`，与声誉和限额相关常量集中管理。
- Phase 3 实现治理逻辑时，`AgentVault.sol` 应通过 `ReputationMath.PROPOSAL_TTL` 引用，避免重复定义治理 TTL。

**新增测试覆盖：**

新增文件：

1. `contracts/test/ReputationMathHarness.sol`
2. `test/unit/ReputationMath.test.js`

`computeWindow` 覆盖声誉点：
- `0`
- `1`
- `50`
- `100`
- `110`
- `200`
- `-1`
- `-10`
- `-100`

`computeLimit` 覆盖声誉点：
- `0`
- `1`
- `50`
- `99`
- `100`
- `150`
- `-1`
- `-10`

**任务 0 占位代码安全性检查结论：**

- 已检查 `proposeAuthorizeAgent`、`proposeRevokeAgent`、`proposeAddStakeholder`、`proposeRemoveStakeholder`、`approveProposal`、`submit`、`veto`、`execute`
- Phase 1 的 `proposalCount = proposalCount;` 和 `requestCount = requestCount;` 属于自赋值，值不会变化，但代码层面仍是 storage 写入模式
- Phase 2 已将这些自赋值替换为局部变量读取，例如 `uint256 currentProposalCount = proposalCount; currentProposalCount;`
- 未发现也未保留对 `proposals`、`agents`、`requests`、`isStakeholder`、`stakeholders` 的占位写入

**验证结果：**

- `npx hardhat compile` 通过，输出 `Compiled 6 Solidity files successfully (evm target: paris).`
- `npx hardhat test` 通过，`17 passing`

**Phase 3 注意事项：**

- `AgentVault.sol` 的 external 业务函数仍保持 `revert("not implemented");`，Phase 3 需要实现治理、Agent 授权、支付请求、veto、execute 和声誉更新逻辑。
- 实现治理 proposal 时，`Proposal` 含 nested mapping，只能存储在 `internal proposals` 中；external 查询继续使用 `getProposal` 的 7 个解包返回值。
- 实现治理 TTL 时使用 `ReputationMath.PROPOSAL_TTL`。
- 当前占位函数为了避免 Solidity mutability warning 会 emit 一个随后被 revert 回滚的 `Deposit(msg.sender, 0)`，Phase 3 实现业务逻辑时应删除这些占位语句。

### ✅ 阶段 3A：治理逻辑（已完成）

**实现的函数列表：**

1. `proposeAuthorizeAgent(address agent)`
2. `proposeRevokeAgent(address agent)`
3. `proposeAddStakeholder(address newStakeholder)`
4. `proposeRemoveStakeholder(address stakeholder)`
5. `approveProposal(uint256 proposalId)`
6. `getProposal(uint256 proposalId)`
7. `hasApproved(uint256 proposalId, address who)`
8. `getStakeholders()`
9. `getAgentProfile(address agent)`
10. `_createProposal(ProposalType pType, address target)`
11. `_executeProposal(uint256 proposalId)`
12. `_findStakeholderIndex(address who)`

**治理状态机关键路径：**

1. Stakeholder 调用 `propose*` 创建 proposal。
2. Proposal 初始化为 `Pending`，提议者自动计入 1 票，并写入 `hasApproved[msg.sender] = true`。
3. 合约依次 emit `ProposalCreated` 和 `ProposalApproved`。
4. 当 `threshold == 1` 时，创建提案的同一笔交易内立即调用 `_executeProposal` 自动执行。
5. 当 `threshold > 1` 时，其他 stakeholder 调用 `approveProposal`；approval count 达到 threshold 后自动调用 `_executeProposal`。
6. `_executeProposal` 根据 `ProposalType` 授权/撤销 Agent，或添加/移除 Stakeholder，最后将 proposal 标记为 `Executed` 并 emit `ProposalExecuted`。

**输入校验与执行时校验：**

- `proposeAuthorizeAgent` 拒绝 zero address，并拒绝已授权 Agent。
- `proposeRevokeAgent` 拒绝未授权 Agent。
- `proposeAddStakeholder` 拒绝 zero address，并拒绝已存在 stakeholder。
- `proposeRemoveStakeholder` 只检查目标当前是 stakeholder，不在提案创建时检查 threshold。
- `RemoveStakeholder` 的 `stakeholders.length - 1 < threshold` 校验放在 `_executeProposal` 中，因为 proposal 创建和执行之间其他 proposal 可能已改变 stakeholder 数量。

**Stakeholder 数组维护方式：**

- 移除 stakeholder 使用 swap-and-pop：
  - 先用 `_findStakeholderIndex` 找到目标下标
  - 若目标不是最后一个元素，则用最后一个 stakeholder 覆盖目标位置
  - 再 `pop()` 删除末尾
  - 最后设置 `isStakeholder[target] = false`
- 该方式不保留数组顺序，但能避免线性搬移。

**测试覆盖：**

新增文件：

1. `test/unit/StakeholderManager.test.js`
2. `test/unit/AgentRegistry.test.js`

覆盖内容：
- 非 stakeholder 无法 propose / approve
- proposal 创建、自动记录 proposer approval、`hasApproved` 查询
- threshold 达成后自动执行
- 重复 approval、未知 proposal、已执行 proposal 的 revert
- 过期 proposal 调用 approval 时 revert `ProposalExpired`
- `threshold == 1` 时 propose 同交易自动执行
- 添加 stakeholder
- 移除 stakeholder
- 创建移除 proposal 时不检查 threshold，执行时若低于 threshold 则 revert `WouldDropBelowThreshold`
- 授权 Agent、撤销 Agent、重复授权/未授权撤销的 revert
- revoke 后再次 authorize，并更新 `authorizedAt`

**跳过的测试用例：**

- Phase 3A 当时暂时跳过了 `Re-authorize after revoke` 中“非零 reputation 在重新授权后保留”的测试。
- Phase 3B 已补完该测试：通过真实 `submit` + `veto` 路径将 reputation 降为 `-3`，再 revoke / re-authorize，确认 reputation 和 `vetoCount` 保留。

**已知 EVM 语义说明：**

- `approveProposal` 的过期分支按规范写入 `p.status = Expired`、emit `ProposalExpiredEvent`，随后 revert `ProposalExpired()`。
- 由于 EVM revert 会回滚状态和日志，测试只能断言 `ProposalExpired` revert；不能在同一笔 reverted 交易后观察到持久化的 `Expired` 状态或事件日志。

**验证结果：**

- `npx hardhat compile` 通过，输出 `Compiled 6 Solidity files successfully (evm target: paris).`
- `npx hardhat test` 通过，`42 passing`，`1 pending`

**Phase 3B 注意事项（已完成）：**

- Phase 3B 已实现 PaymentQueue 和 ReputationEngine：
  - `submit` 使用 `ReputationMath.computeWindow` 和 `computeLimit`
  - `veto` 后 reputation 按 `PENALTY_PER_VETO` 下降并 clamp 到 `REPUTATION_MIN`
  - `execute` 成功后 reputation 按 `REWARD_PER_SUCCESS` 上升并 clamp 到 `REPUTATION_MAX`
  - recipient revert 时请求状态变为 `Failed`，reputation 不变
  - `execute` 必须继续使用 `nonReentrant` 和 CEI 顺序

### ✅ 阶段 3B：PaymentQueue 与 ReputationEngine（已完成）

**实现的函数列表：**

1. `submit(address payable recipient, uint128 amount, bytes32 intentHash)`
2. `veto(uint256 requestId)`
3. `execute(uint256 requestId)`
4. `getRequest(uint256 requestId)`
5. `currentWindow(address agent)`
6. `currentLimit(address agent)`
7. `_clampReputationAfterSuccess(int32 oldRep)`
8. `_clampReputationAfterVeto(int32 oldRep)`

**PaymentQueue 实现要点：**

- `submit`：
  - 仅 authorized agent 可调用
  - 校验 `amount != 0`
  - 校验 `recipient != address(0)`
  - 使用 `ReputationMath.computeLimit` 校验单笔额度
  - 使用 `ReputationMath.computeWindow` 冻结 `executableAt`
  - 写入 `PaymentRequest` 并 emit `PaymentRequested`

- `veto`：
  - 仅 stakeholder 可调用
  - 对不存在 request 使用 `r.agent == address(0)` 检查并 revert `RequestNotPending`
  - 只允许 `Pending` request 被 veto
  - 状态改为 `Vetoed`，记录 `vetoedBy`
  - reputation 按 `PENALTY_PER_VETO` 下降并 clamp 到 `REPUTATION_MIN`
  - `vetoCount += 1`
  - emit `PaymentVetoed` 和 `ReputationChanged(..., "VETO")`

- `execute`：
  - permissionless，任何地址可调用
  - 使用 `nonReentrant`
  - 对不存在 request 使用 `r.agent == address(0)` 检查并 revert `RequestNotPending`
  - 校验 request 是 `Pending`
  - 校验 `block.timestamp >= executableAt`
  - 校验执行时 vault 余额足够，否则 revert `InsufficientBalance`

**CEI 顺序和 Failed 状态覆盖：**

- `execute` 在外部 call 之前先执行 effects：`r.status = RequestStatus.Executed`
- 随后缓存 `recipient`、`amount`、`agent` 到局部变量，再调用 `recipient.call{value: amount}("")`
- 如果 call 成功：
  - `successCount += 1`
  - reputation 按 `REWARD_PER_SUCCESS` 上升并 clamp 到 `REPUTATION_MAX`
  - emit `PaymentExecuted` 和 `ReputationChanged(..., "SUCCESS")`
- 如果 call 失败：
  - 在同一笔交易内把状态从 `Executed` 覆盖为 `Failed`
  - emit `PaymentFailed(requestId, returnData)`
  - reputation、`successCount`、`vetoCount` 均不变

**Reputation clamp 位置选择：**

- clamp 放在 `AgentVault.sol` 内部 helper，而不是放进 `ReputationMath.sol`
- 原因：`ReputationMath` 负责纯参数计算；合约侧负责读取/写入 `AgentProfile` 状态
- `_clampReputationAfterSuccess` 在加法前先检查 `oldRep >= REPUTATION_MAX - REWARD_PER_SUCCESS`
- `_clampReputationAfterVeto` 在减法前先检查 `oldRep <= REPUTATION_MIN + PENALTY_PER_VETO`
- 这样避免 int32 边界附近发生中间运算溢出

**新增测试合约：**

1. `contracts/test/RevertingRecipient.sol`
   - `receive()` 永远 revert，用于验证 `Failed` 状态、资金留在 vault、reputation 不变

2. `contracts/test/MaliciousRecipient.sol`
   - `receive()` 中尝试重入 `vault.execute(targetRequestId)`
   - 使用 try/catch 吞掉 ReentrancyGuard 的 revert，让外层 `.call` 保持成功
   - 用于验证外层 execute 成功、重入被阻止、reputation 只增加 1

**新增/更新测试文件：**

1. `test/unit/PaymentQueue.test.js`
2. `test/unit/ReputationEngine.test.js`
3. `test/unit/AgentRegistry.test.js`

**测试覆盖的 edge case：**

- 非 agent 调用 `submit` revert `NotAgent`
- `amount == 0` revert `AmountZero`
- zero recipient revert `InvalidRecipient`
- amount 超过当前 reputation limit revert `AmountExceedsLimit`
- 成功 submit 后 request 字段、`requestCount`、`executableAt`、事件正确
- 非 stakeholder 调用 `veto` revert `NotStakeholder`
- veto 不存在 request revert `RequestNotPending`
- veto 成功后状态、`vetoedBy`、reputation、`vetoCount`、事件正确
- 已 veto request 再 veto revert
- window 已过但尚未 execute 时仍可 veto
- outsider 可 permissionless execute
- execute 不存在 request revert
- window 未到 execute revert `WindowNotElapsed`
- execute 时 vault 余额不足 revert `InsufficientBalance`
- EOA recipient 成功收款，vault 余额减少，success count 和 reputation 更新
- Vetoed request execute revert
- 双重 execute revert
- reverting recipient 导致 `Failed`，资金留在 vault，reputation 不变，无 `ReputationChanged`
- malicious recipient 尝试 reentrancy，外层成功，`attackedOnce == true`，只出现一次 `PaymentExecuted`，reputation 只 +1
- pending request 的 `executableAt` 不因后续 reputation 变化而改变
- reputation 下限 clamp 到 `-10`
- reputation 上限 clamp 到 `100`
- `currentWindow` 和 `currentLimit` 会随 reputation 变化返回新值
- 补完 Phase 3A 跳过用例：revoke 后重新 authorize 保留 nonzero reputation 和 `vetoCount`

**实现中的项目外决定：**

- `submit` 未做提交时余额检查，余额不足统一在 `execute` 阶段用 `InsufficientBalance` 处理。
- 原因：Phase 3B 任务的 `submit` 实现步骤没有包含余额检查，且测试要求覆盖“提交后执行时余额不足”的场景；若提交时检查余额，该测试无法成立。

**验证结果：**

- `npx hardhat compile` 通过，输出 `Compiled 8 Solidity files successfully (evm target: paris).`
- `npx hardhat test` 通过，`72 passing`
- `AgentVault.sol` 中已无 `revert("not implemented");`

**Phase 4 注意事项：**

- 补集成场景测试 `test/integration/Scenarios.test.js`
- 编写 `scripts/deploy.js`
- 编写 demo 脚本 `scripts/demo/scenarioA.js`、`scenarioB.js`、`scenarioC.js`
- 可补充 README 使用说明、部署参数、Sepolia 演示流程
- 后续若做 coverage，需要关注 Phase 3A 的过期 proposal 分支中 EVM revert 回滚事件/状态的测试可观测性限制

### ✅ 阶段 4+5：集成场景与部署脚本（已完成）

**新增/修改文件：**

1. `test/integration/Scenarios.test.js`
2. `scripts/deploy.js`
3. `scripts/demo/scenarioA.js`
4. `scripts/demo/scenarioB.js`
5. `scripts/demo/scenarioC.js`
6. `deployments/.gitkeep`
7. `deployments/localhost.json`
8. `package.json`

**集成测试三个场景覆盖点：**

1. Scenario A: optimistic execution success
   - 多签授权后的 Agent 提交 `0.005 ETH` payment request
   - 初始 `currentWindow(agent) == 3600`
   - `executableAt == submittedAt + 3600`
   - window 后 outsider permissionless 调用 `execute`
   - request 进入 `Executed`
   - recipient 余额增加、vault 余额减少
   - Agent reputation 从 `0` 到 `1`，`successCount == 1`
   - 验证 `PaymentRequested`、`PaymentExecuted`、`ReputationChanged("SUCCESS")`

2. Scenario B: stakeholder veto
   - Agent submit 后 request 为 `Pending`
   - stakeholder3 在 window 内调用 `veto`
   - request 进入 `Vetoed`
   - `vetoedBy == stakeholder3`
   - Agent reputation 从 `0` 到 `-3`，`vetoCount == 1`
   - vault 和 recipient 余额不变
   - 验证 `PaymentVetoed`、`ReputationChanged("VETO")`
   - 终态 request 再 execute 会 revert `RequestNotPending`

3. Scenario C: reputation drives window and limit
   - 初始 window 为 `3600`，limit 为 `0.01 ETH`
   - 连续 5 次 submit + time increase + execute，把 reputation 提升到 `5`
   - 验证 window 变为 `3450`
   - 验证 limit 变为 `0.06 ETH`
   - `0.05 ETH` request 可提交
   - `0.061 ETH` request revert `AmountExceedsLimit`
   - 后续 veto 将 reputation 从 `5` 降到 `2`
   - 验证 window 变为 `3540`，limit 变为 `0.03 ETH`

**部署脚本设计：**

- `scripts/deploy.js` 支持 `localhost` 和 `sepolia`
- stakeholder 选择逻辑：
  - 如果存在环境变量 `STAKEHOLDERS`，按逗号分隔地址解析
  - 否则使用 `ethers.getSigners()` 的前三个地址
- threshold 选择逻辑：
  - 从环境变量 `THRESHOLD` 读取
  - 默认值为 `2`
- Sepolia 部署会等待 5 个 confirmations
- 部署结果写入 `deployments/<network>.json`

**deployments JSON 格式：**

```json
{
  "address": "0x...",
  "stakeholders": ["0x...", "0x...", "0x..."],
  "threshold": 2,
  "deployedAt": 1778690554,
  "deployer": "0x..."
}
```

**本地部署验证：**

- 已启动 localhost Hardhat node 并运行：
  - `npx hardhat run scripts/deploy.js --network localhost`
- 已生成 `deployments/localhost.json`
- 本地部署地址：`0x5FbDB2315678afecb367f032d93F642f64180aa3`

**demo 脚本叙事化设计：**

- 三个 demo 脚本都从 `deployments/<network>.json` 读取 vault 地址
- 三个 demo 脚本均设计为 localhost 演示脚本，因为需要 `evm_increaseTime`
- 共同前置逻辑：
  - 如果 vault 余额不足，自动从 signer[0] 充值
  - 如果 agent 未授权，自动走 stakeholder1 propose + stakeholder2 approve
  - 如果 agent 已授权，则跳过授权步骤，支持重复运行
- `scenarioA.js` 演示 optimistic execution：submit → fast-forward → outsider execute → reputation 上升
- `scenarioB.js` 演示 stakeholder veto：submit → stakeholder3 veto → execute blocked
- `scenarioC.js` 演示 reputation-driven params：
  - 至少执行 5 轮成功请求
  - 如果脚本重复运行导致初始 reputation 不是 0，会继续运行直到 reputation 足够展示 `0.05 ETH` request
  - over-limit 金额按当前 limit 动态计算为 `currentLimit + 0.001 ETH`，确保重复运行时仍会触发 `AmountExceedsLimit`

**npm scripts 列表：**

```json
{
  "compile": "hardhat compile",
  "test": "hardhat test",
  "test:unit": "hardhat test test/unit",
  "test:integration": "hardhat test test/integration",
  "coverage": "hardhat coverage",
  "node": "hardhat node",
  "deploy:local": "hardhat run scripts/deploy.js --network localhost",
  "deploy:sepolia": "hardhat run scripts/deploy.js --network sepolia",
  "demo:a": "hardhat run scripts/demo/scenarioA.js --network localhost",
  "demo:b": "hardhat run scripts/demo/scenarioB.js --network localhost",
  "demo:c": "hardhat run scripts/demo/scenarioC.js --network localhost"
}
```

**验证结果：**

- `npx hardhat compile` 通过，输出 `Compiled 8 Solidity files successfully (evm target: paris).`
- `npx hardhat test` 通过，`75 passing`
- `npx hardhat run scripts/deploy.js --network localhost` 已通过
- `npx hardhat run scripts/demo/scenarioA.js --network localhost` 已通过
- `npx hardhat run scripts/demo/scenarioB.js --network localhost` 已通过
- `npx hardhat run scripts/demo/scenarioC.js --network localhost` 已通过

**Phase 6 注意事项：**

- 准备 `.env` 中的 `SEPOLIA_RPC_URL`、`PRIVATE_KEY`、`ETHERSCAN_API_KEY`
- 运行 `npm run deploy:sepolia`
- 根据部署脚本输出的 verify 命令手动执行 Etherscan verify
- 将生成的 `deployments/sepolia.json` 提交到仓库，方便评委直接查看测试网地址
- 可补充 `README.md` 的安装、测试、部署、demo 使用说明
- 可创建课程报告大纲 `REPORT_OUTLINE.md`

### ✅ 阶段 6：Sepolia 部署准备（已完成）

**本阶段目标：**

Phase 6 的真实 Sepolia 部署由用户本地执行。本阶段已完成部署前准备工作，让用户执行 `deploy:sepolia`、Etherscan verify 和 Remix 手动测试时尽量零摩擦。

**新增/修改文件：**

1. `scripts/deploy.js`
2. `scripts/sepoliaSanityCheck.js`
3. `docs/SEPOLIA_GUIDE.md`
4. `hardhat.config.js`
5. `.env.example`
6. `package.json`
7. `PROGRESS.md`

**deploy.js 优化记录：**

- Sepolia 部署时继续等待 5 confirmations。
- 部署输出新增：
  - contract address
  - deployment transaction hash
  - block number
  - gas used
  - stakeholder addresses
  - threshold
- 自动生成 constructor args 文件：
  - `deployments/sepolia-args.js`
- Sepolia verify 命令改为稳定形式：

```bash
npx hardhat verify --network sepolia <ADDRESS> --constructor-args deployments/sepolia-args.js
```

**verify args 文件格式：**

```js
// Auto-generated by scripts/deploy.js
module.exports = [
  ["0xStakeholder1", "0xStakeholder2", "0xStakeholder3"],
  2
];
```

**Sepolia sanity check：**

新增 `scripts/sepoliaSanityCheck.js`，通过 `npm run verify:sepolia` 执行。

该脚本从 `deployments/sepolia.json` 读取 vault 地址，并执行无需等待 challenge window 的 view 检查：

1. `getStakeholders()` 长度等于 deployment JSON 里的 stakeholders 数量
2. `currentWindow(0x0000000000000000000000000000000000000000) == 3600`
3. `currentLimit(0x0000000000000000000000000000000000000000) == 0.01 ether`

脚本最后提示用户剩余 authorize / submit / veto / execute 检查需要按 `docs/SEPOLIA_GUIDE.md` 在 Remix 手动完成。

**hardhat.config.js 更新：**

- Solidity 编译设置新增：
  - `evmVersion: "paris"`
- Sepolia 网络配置新增：
  - `chainId: 11155111`

这样可以避免新 EVM 默认 opcode 与测试网节点兼容性问题，并使网络配置更明确。

**.env.example 更新：**

现在覆盖：

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY_HERE
STAKEHOLDERS=0xAAA,0xBBB,0xCCC
THRESHOLD=2
REPORT_GAS=false
```

**新增 npm script：**

```json
"verify:sepolia": "hardhat run scripts/sepoliaSanityCheck.js --network sepolia"
```

**SEPOLIA_GUIDE.md 章节结构：**

1. `Prerequisites`
2. `Setup`
3. `Deploy`
4. `Verify on Etherscan`
5. `Sanity Check (automated view functions)`
6. `Manual Testing on Remix (the critical part)`
   - Connect Remix to deployed contract
   - Verify initial state
   - Authorize an Agent
   - Agent submits a request
   - Stakeholder vetoes
   - Test execution after 1 hour
   - Inspect events on Etherscan
7. `Troubleshooting`

**验证结果：**

- `node --check` 已检查部署脚本、sanity check 脚本和 demo 脚本语法
- `npx hardhat compile` 通过，输出 `Compiled 8 Solidity files successfully (evm target: paris).`
- `npx hardhat test` 通过，`75 passing`

**用户下一步：**

1. 配置 `.env`
2. 确保 deployer 有 Sepolia ETH
3. 执行 `npm run deploy:sepolia`
4. 执行部署脚本输出的 Etherscan verify 命令
5. 执行 `npm run verify:sepolia`
6. 按 `docs/SEPOLIA_GUIDE.md` 在 Remix 完成手动测试
7. 将 `deployments/sepolia.json` 和 `deployments/sepolia-args.js` 保留/提交，方便评委复现

---

## 当前目录结构

```
agentvault/
├── contracts/
│   ├── AgentVault.sol              ← Phase 3B 已完成业务逻辑
│   ├── interfaces/
│   │   └── IAgentVault.sol         ← external interface 已创建
│   ├── libraries/
│   │   └── ReputationMath.sol      ← Phase 2 已实现常量和公式
│   └── test/
│       ├── MaliciousRecipient.sol  ← Phase 3B reentrancy 测试合约
│       ├── RevertingRecipient.sol  ← Phase 3B Failed 状态测试合约
│       └── ReputationMathHarness.sol ← ReputationMath 单元测试 harness
├── test/
│   ├── unit/
│   │   ├── AgentRegistry.test.js   ← Phase 3A 已完成
│   │   ├── PaymentQueue.test.js    ← Phase 3B 已完成
│   │   ├── ReputationMath.test.js  ← Phase 2 已完成
│   │   ├── ReputationEngine.test.js ← Phase 3B 已完成
│   │   ├── StakeholderManager.test.js ← Phase 3A 已完成
│   │   └── .gitkeep
│   └── integration/
│       ├── Scenarios.test.js       ← Phase 4+5 已完成
│       └── .gitkeep
├── scripts/
│   ├── deploy.js                   ← Phase 4+5 已完成
│   ├── sepoliaSanityCheck.js       ← Phase 6 已完成
│   ├── .gitkeep
│   └── demo/
│       ├── scenarioA.js            ← Phase 4+5 已完成
│       ├── scenarioB.js            ← Phase 4+5 已完成
│       ├── scenarioC.js            ← Phase 4+5 已完成
│       └── .gitkeep
├── deployments/
│   ├── localhost.json              ← localhost 部署验证产物
│   └── .gitkeep
├── docs/
│   └── SEPOLIA_GUIDE.md            ← Phase 6 已完成
├── node_modules/                   ← 已安装
├── AGENT.md                        ← 项目规范（Phase 2 已按用户授权更新窗口参数）
├── PROGRESS.md                     ← 本文件
├── hardhat.config.js               ← 已配置
├── package.json                    ← 已生成
├── package-lock.json               ← 已生成
├── .env.example                    ← 已创建
├── .gitignore                      ← 已创建
└── README.md                       ← 已创建
```

---

## 关键配置文件内容

### hardhat.config.js

```js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "0".repeat(64);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY },
  gasReporter: { enabled: process.env.REPORT_GAS === "true" },
};
```

### .env.example

```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY_HERE
STAKEHOLDERS=0xAAA,0xBBB,0xCCC
THRESHOLD=2
REPORT_GAS=false
```

---

## 下一步：阶段 7 — Sepolia 实际部署与最终文档

需要完成：

### 1. Sepolia 部署

- 配置 `.env`
- 运行 `npm run deploy:sepolia`
- 执行部署脚本输出的 Etherscan verify 命令
- 提交 `deployments/sepolia.json`
- 运行 `npm run verify:sepolia`
- 按 `docs/SEPOLIA_GUIDE.md` 完成 Remix 手动测试

### 2. 项目文档

- 更新 `README.md`
- 创建或完善 `REPORT_OUTLINE.md`
- 写明本地 demo、测试网部署和课程展示流程

---

## 架构要点备忘（来自 AGENT.md）

### 核心数据结构

```solidity
enum ProposalType { AuthorizeAgent, RevokeAgent, AddStakeholder, RemoveStakeholder }
enum ProposalStatus { Pending, Executed, Expired, Cancelled }
enum RequestStatus { Pending, Executed, Vetoed, Failed }

struct Proposal { ... }         // 含 nested mapping，需 internal 存储
struct PaymentRequest { ... }   // executableAt 在提交时冻结
struct AgentProfile { ... }     // authorized, reputation, successCount, vetoCount
```

### 声誉常量

```
REPUTATION_MIN = -10, REPUTATION_MAX = 100
REWARD_PER_SUCCESS = 1, PENALTY_PER_VETO = 3
BASE_WINDOW = 86400 (24h), MIN_WINDOW = 3600 (1h), WINDOW_SLOPE = 600
Phase 2 已更新为：BASE_WINDOW = 3600 (1h), MIN_WINDOW = 300 (5m), WINDOW_SLOPE = 30
BASE_LIMIT = 0.01 ether, MAX_LIMIT = 1 ether, LIMIT_SLOPE = 0.01 ether
PROPOSAL_TTL = 7 days
```

### 关键安全要求
- `execute()` 必须用 `nonReentrant`
- 严格 CEI 顺序：先改状态，再外部调用
- 不用 `tx.origin`，不用 `unchecked`，不用 `selfdestruct`

---

## 完成标准（每个阶段）

- `npx hardhat compile` 零 warning
- `npx hardhat test` 100% 通过
- 所有 external/public 函数有 NatSpec
- 无 `console.log`，无注释掉的代码，无无解释的 TODO

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ReputationMath.sol";

/// @title AgentVault
/// @notice Smart contract wallet for AI Agents with optimistic execution and stakeholder veto
contract AgentVault is ReentrancyGuard {


    enum ProposalType {
        AuthorizeAgent,
        RevokeAgent,
        AddStakeholder,
        RemoveStakeholder
    }

    enum ProposalStatus {
        Pending,
        Executed,
        Expired,
        Cancelled
    }

    enum RequestStatus {
        Pending,
        Executed,
        Vetoed,
        Failed
    }

    struct Proposal {
        ProposalType pType;
        address target;
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
        uint64 executableAt;
        RequestStatus status;
        address vetoedBy;
    }

    struct AgentProfile {
        bool authorized;
        int32 reputation;
        uint64 authorizedAt;
        uint32 successCount;
        uint32 vetoCount;
    }

    address[] public stakeholders;
    mapping(address => bool) public isStakeholder;
    uint8 public threshold;

    mapping(uint256 => Proposal) internal proposals;
    uint256 public proposalCount;

    mapping(address => AgentProfile) public agents;
    mapping(uint256 => PaymentRequest) public requests;
    uint256 public requestCount;

    event ProposalCreated(uint256 indexed proposalId, ProposalType indexed pType, address indexed target, address proposer);
    event ProposalApproved(uint256 indexed proposalId, address indexed approver, uint8 approvalCount);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalExpiredEvent(uint256 indexed proposalId);
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
    event Deposit(address indexed from, uint256 amount);

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

    modifier onlyStakeholder() {
        if (!isStakeholder[msg.sender]) revert NotStakeholder();
        _;
    }

    modifier onlyAuthorizedAgent() {
        if (!agents[msg.sender].authorized) revert NotAgent();
        _;
    }

    // ============================================================
    // MODULE 1: STAKEHOLDER MANAGER (multisig governance)
    // ============================================================

    /// @notice Initializes the vault with the initial stakeholder set and fixed governance threshold
    /// @dev Zero address stakeholders reuse InvalidThreshold because AGENT.md defines no dedicated zero-address error for constructor input
    /// @param _stakeholders The initial stakeholder addresses
    /// @param _threshold The fixed number of approvals required to execute governance proposals
    constructor(address[] memory _stakeholders, uint8 _threshold) {
        if (_stakeholders.length == 0) revert EmptyStakeholders();
        if (_threshold == 0 || _threshold > _stakeholders.length) revert InvalidThreshold();

        for (uint256 i = 0; i < _stakeholders.length; i++) {
            address stakeholder = _stakeholders[i];
            if (stakeholder == address(0)) revert InvalidThreshold();
            if (isStakeholder[stakeholder]) revert AlreadyStakeholder();

            stakeholders.push(stakeholder);
            isStakeholder[stakeholder] = true;
        }

        threshold = _threshold;
    }

    /// @notice Accepts direct ETH deposits into the vault
    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Creates a proposal to authorize an agent
    /// @param agent The agent address to authorize
    /// @return proposalId The ID of the created proposal
    function proposeAuthorizeAgent(address agent) external onlyStakeholder returns (uint256) {
        if (agent == address(0)) revert InvalidRecipient();
        if (agents[agent].authorized) revert AgentAlreadyAuthorized();

        return _createProposal(ProposalType.AuthorizeAgent, agent);
    }

    /// @notice Creates a proposal to revoke an authorized agent
    /// @param agent The agent address to revoke
    /// @return proposalId The ID of the created proposal
    function proposeRevokeAgent(address agent) external onlyStakeholder returns (uint256) {
        if (!agents[agent].authorized) revert AgentNotAuthorized();

        return _createProposal(ProposalType.RevokeAgent, agent);
    }

    /// @notice Creates a proposal to add a stakeholder
    /// @param newStakeholder The stakeholder address to add
    /// @return proposalId The ID of the created proposal
    function proposeAddStakeholder(address newStakeholder) external onlyStakeholder returns (uint256) {
        if (newStakeholder == address(0)) revert InvalidRecipient();
        if (isStakeholder[newStakeholder]) revert AlreadyStakeholder();

        return _createProposal(ProposalType.AddStakeholder, newStakeholder);
    }

    /// @notice Creates a proposal to remove a stakeholder
    /// @param stakeholder The stakeholder address to remove
    /// @return proposalId The ID of the created proposal
    function proposeRemoveStakeholder(address stakeholder) external onlyStakeholder returns (uint256) {
        if (!isStakeholder[stakeholder]) revert NotStakeholder();

        return _createProposal(ProposalType.RemoveStakeholder, stakeholder);
    }

    /// @notice Approves a pending governance proposal
    /// @param proposalId The proposal ID to approve
    function approveProposal(uint256 proposalId) external onlyStakeholder {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.status != ProposalStatus.Pending) revert ProposalNotPending();

        if (block.timestamp > p.expiresAt) {
            p.status = ProposalStatus.Expired;
            emit ProposalExpiredEvent(proposalId);
            revert ProposalExpired();
        }

        if (p.hasApproved[msg.sender]) revert ProposalAlreadyApproved();

        p.hasApproved[msg.sender] = true;
        p.approvalCount++;
        emit ProposalApproved(proposalId, msg.sender, p.approvalCount);

        if (p.approvalCount >= threshold) {
            _executeProposal(proposalId);
        }
    }

    /// @notice Returns a proposal's fields except its nested approval mapping
    /// @param proposalId The proposal ID to inspect
    /// @return pType The proposal type
    /// @return target The proposal target address
    /// @return proposer The stakeholder that created the proposal
    /// @return createdAt The timestamp when the proposal was created
    /// @return expiresAt The timestamp when the proposal expires
    /// @return status The current proposal status
    /// @return approvalCount The number of stakeholder approvals
    function getProposal(uint256 proposalId)
        external
        view
        returns (
            ProposalType,
            address,
            address,
            uint64,
            uint64,
            ProposalStatus,
            uint8
        )
    {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();

        return (p.pType, p.target, p.proposer, p.createdAt, p.expiresAt, p.status, p.approvalCount);
    }

    /// @notice Checks whether an address has approved a proposal
    /// @param proposalId The proposal ID to inspect
    /// @param who The address to check
    /// @return approved Whether the address has approved the proposal
    function hasApproved(uint256 proposalId, address who) external view returns (bool) {
        return proposals[proposalId].hasApproved[who];
    }

    /// @notice Returns the current stakeholder list
    /// @return The current stakeholder addresses
    function getStakeholders() external view returns (address[] memory) {
        return stakeholders;
    }

    // ============================================================
    // MODULE 2: AGENT REGISTRY (agent authorization state)
    // ============================================================

    /// @notice Returns an agent's profile
    /// @param agent The agent address to inspect
    /// @return The agent profile
    function getAgentProfile(address agent) external view returns (AgentProfile memory) {
        return agents[agent];
    }

    // ============================================================
    // MODULE 3: PAYMENT QUEUE (request lifecycle)
    // ============================================================

    /// @notice Submits a payment request to the queue
    /// @param recipient The address that will receive funds if executed
    /// @param amount The amount of wei to send
    /// @param intentHash A keccak256 hash of the off-chain intent statement
    /// @return requestId The ID of the created payment request
    function submit(address payable recipient, uint128 amount, bytes32 intentHash)
        external
        onlyAuthorizedAgent
        returns (uint256)
    {
        if (amount == 0) revert AmountZero();
        if (recipient == address(0)) revert InvalidRecipient();

        int32 reputation = agents[msg.sender].reputation;
        uint128 limit = ReputationMath.computeLimit(reputation);
        if (amount > limit) revert AmountExceedsLimit(amount, limit);

        uint64 submittedAt = uint64(block.timestamp);
        uint64 executableAt = submittedAt + ReputationMath.computeWindow(reputation);

        uint256 requestId = requestCount;
        requestCount++;

        PaymentRequest storage r = requests[requestId];
        r.agent = msg.sender;
        r.recipient = recipient;
        r.amount = amount;
        r.intentHash = intentHash;
        r.submittedAt = submittedAt;
        r.executableAt = executableAt;
        r.status = RequestStatus.Pending;
        r.vetoedBy = address(0);

        emit PaymentRequested(requestId, msg.sender, recipient, amount, intentHash, executableAt);

        return requestId;
    }

    /// @notice Vetoes a pending payment request
    /// @param requestId The request ID to veto
    function veto(uint256 requestId) external onlyStakeholder {
        PaymentRequest storage r = requests[requestId];
        if (r.agent == address(0) || r.status != RequestStatus.Pending) revert RequestNotPending();

        r.status = RequestStatus.Vetoed;
        r.vetoedBy = msg.sender;

        int32 oldRep = agents[r.agent].reputation;
        int32 newRep = _clampReputationAfterVeto(oldRep);
        agents[r.agent].reputation = newRep;
        agents[r.agent].vetoCount += 1;

        emit PaymentVetoed(requestId, msg.sender);
        emit ReputationChanged(r.agent, oldRep, newRep, "VETO");
    }

    /// @notice Executes an eligible pending payment request
    /// @param requestId The request ID to execute
    function execute(uint256 requestId) external nonReentrant {
        PaymentRequest storage r = requests[requestId];
        if (r.agent == address(0) || r.status != RequestStatus.Pending) revert RequestNotPending();
        if (block.timestamp < r.executableAt) revert WindowNotElapsed(uint64(block.timestamp), r.executableAt);
        if (address(this).balance < r.amount) revert InsufficientBalance(r.amount, address(this).balance);

        r.status = RequestStatus.Executed;

        address payable recipient_ = r.recipient;
        uint128 amount_ = r.amount;
        address agent_ = r.agent;

        (bool ok, bytes memory returnData) = recipient_.call{value: amount_}("");

        if (ok) {
            agents[agent_].successCount += 1;
            int32 oldRep = agents[agent_].reputation;
            int32 newRep = _clampReputationAfterSuccess(oldRep);
            agents[agent_].reputation = newRep;

            emit PaymentExecuted(requestId);
            emit ReputationChanged(agent_, oldRep, newRep, "SUCCESS");
        } else {
            r.status = RequestStatus.Failed;
            emit PaymentFailed(requestId, returnData);
        }
    }

    /// @notice Returns a payment request
    /// @param requestId The request ID to inspect
    /// @return The payment request
    function getRequest(uint256 requestId) external view returns (PaymentRequest memory) {
        return requests[requestId];
    }

    // ============================================================
    // MODULE 4: REPUTATION ENGINE (reputation + dynamic params)
    // ============================================================

    /// @notice Returns the current challenge window for an agent
    /// @param agent The agent address to inspect
    /// @return The current challenge window in seconds
    function currentWindow(address agent) external view returns (uint64) {
        return ReputationMath.computeWindow(agents[agent].reputation);
    }

    /// @notice Returns the current per-payment limit for an agent
    /// @param agent The agent address to inspect
    /// @return The current per-payment limit in wei
    function currentLimit(address agent) external view returns (uint128) {
        return ReputationMath.computeLimit(agents[agent].reputation);
    }

    function _createProposal(ProposalType pType, address target) internal returns (uint256 proposalId) {
        proposalId = proposalCount;
        proposalCount++;

        Proposal storage p = proposals[proposalId];
        p.pType = pType;
        p.target = target;
        p.proposer = msg.sender;
        p.createdAt = uint64(block.timestamp);
        p.expiresAt = uint64(block.timestamp) + ReputationMath.PROPOSAL_TTL;
        p.status = ProposalStatus.Pending;
        p.approvalCount = 1;
        p.hasApproved[msg.sender] = true;

        emit ProposalCreated(proposalId, pType, target, msg.sender);
        emit ProposalApproved(proposalId, msg.sender, 1);

        if (threshold == 1) {
            _executeProposal(proposalId);
        }
    }

    function _executeProposal(uint256 proposalId) internal {
        Proposal storage p = proposals[proposalId];
        assert(p.status == ProposalStatus.Pending);

        if (p.pType == ProposalType.AuthorizeAgent) {
            agents[p.target].authorized = true;
            agents[p.target].authorizedAt = uint64(block.timestamp);
            emit AgentAuthorized(p.target, proposalId);
        } else if (p.pType == ProposalType.RevokeAgent) {
            agents[p.target].authorized = false;
            emit AgentRevoked(p.target, proposalId);
        } else if (p.pType == ProposalType.AddStakeholder) {
            if (isStakeholder[p.target]) revert AlreadyStakeholder();

            stakeholders.push(p.target);
            isStakeholder[p.target] = true;
            emit StakeholderAdded(p.target, proposalId);
        } else if (p.pType == ProposalType.RemoveStakeholder) {
            if (!isStakeholder[p.target]) revert NotStakeholder();
            if (stakeholders.length - 1 < threshold) revert WouldDropBelowThreshold();

            uint256 idx = _findStakeholderIndex(p.target);
            uint256 lastIdx = stakeholders.length - 1;
            if (idx != lastIdx) {
                stakeholders[idx] = stakeholders[lastIdx];
            }
            stakeholders.pop();
            isStakeholder[p.target] = false;
            emit StakeholderRemoved(p.target, proposalId);
        }

        p.status = ProposalStatus.Executed;
        emit ProposalExecuted(proposalId);
    }

    function _findStakeholderIndex(address who) internal view returns (uint256) {
        uint256 len = stakeholders.length;
        for (uint256 i = 0; i < len; i++) {
            if (stakeholders[i] == who) return i;
        }
        revert NotStakeholder();
    }

    function _clampReputationAfterSuccess(int32 oldRep) internal pure returns (int32) {
        if (oldRep >= ReputationMath.REPUTATION_MAX - ReputationMath.REWARD_PER_SUCCESS) {
            return ReputationMath.REPUTATION_MAX;
        }

        return oldRep + ReputationMath.REWARD_PER_SUCCESS;
    }

    function _clampReputationAfterVeto(int32 oldRep) internal pure returns (int32) {
        if (oldRep <= ReputationMath.REPUTATION_MIN + ReputationMath.PENALTY_PER_VETO) {
            return ReputationMath.REPUTATION_MIN;
        }

        return oldRep - ReputationMath.PENALTY_PER_VETO;
    }
}

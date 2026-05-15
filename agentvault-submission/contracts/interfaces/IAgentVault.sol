// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAgentVault
/// @notice External interface for the AgentVault contract
interface IAgentVault {
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

    function proposeAuthorizeAgent(address agent) external returns (uint256);
    function proposeRevokeAgent(address agent) external returns (uint256);
    function proposeAddStakeholder(address newStakeholder) external returns (uint256);
    function proposeRemoveStakeholder(address stakeholder) external returns (uint256);
    function approveProposal(uint256 proposalId) external;
    function submit(address payable recipient, uint128 amount, bytes32 intentHash) external returns (uint256);
    function veto(uint256 requestId) external;
    function execute(uint256 requestId) external;

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
        );

    function hasApproved(uint256 proposalId, address who) external view returns (bool);
    function getRequest(uint256 requestId) external view returns (PaymentRequest memory);
    function getAgentProfile(address agent) external view returns (AgentProfile memory);
    function getStakeholders() external view returns (address[] memory);
    function currentWindow(address agent) external view returns (uint64);
    function currentLimit(address agent) external view returns (uint128);
}

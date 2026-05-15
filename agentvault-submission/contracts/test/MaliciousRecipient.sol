// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAgentVaultLite {
    function execute(uint256 requestId) external;
}

/// @dev Attempts reentrancy into execute on ETH receipt.
/// Used to verify ReentrancyGuard blocks recursive calls.
contract MaliciousRecipient {
    IAgentVaultLite public vault;
    uint256 public targetRequestId;
    bool public attackedOnce;

    function setTarget(address _vault, uint256 _requestId) external {
        vault = IAgentVaultLite(_vault);
        targetRequestId = _requestId;
    }

    receive() external payable {
        if (!attackedOnce) {
            attackedOnce = true;
            try vault.execute(targetRequestId) {
                // Unexpected success means the outer test should fail via state assertions.
            } catch {
                // ReentrancyGuard should block the recursive call; swallow it so the outer call can continue.
            }
        }
    }
}

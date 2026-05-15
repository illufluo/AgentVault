// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Always reverts on ETH receipt. Used to test Failed state handling.
contract RevertingRecipient {
    receive() external payable {
        revert("RevertingRecipient: I refuse");
    }
}

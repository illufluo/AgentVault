// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../libraries/ReputationMath.sol";

/// @dev Test-only harness exposing ReputationMath functions for unit tests.
/// Not part of production deployment.
contract ReputationMathHarness {
    function window(int32 rep) external pure returns (uint64) {
        return ReputationMath.computeWindow(rep);
    }

    function limit(int32 rep) external pure returns (uint128) {
        return ReputationMath.computeLimit(rep);
    }
}

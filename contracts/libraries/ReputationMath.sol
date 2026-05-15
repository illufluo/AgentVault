// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ReputationMath
/// @notice Pure functions for reputation-driven dynamic parameters
library ReputationMath {
    int32 constant REPUTATION_MIN = -10;
    int32 constant REPUTATION_MAX = 100;
    int32 constant REWARD_PER_SUCCESS = 1;
    int32 constant PENALTY_PER_VETO = 3;

    uint64 constant BASE_WINDOW = 3600;
    uint64 constant MIN_WINDOW = 300;
    uint64 constant WINDOW_SLOPE = 30;

    uint128 constant BASE_LIMIT = 0.01 ether;
    uint128 constant MAX_LIMIT = 1 ether;
    uint128 constant LIMIT_SLOPE = 0.01 ether;

    uint64 constant PROPOSAL_TTL = 7 days;

    /// @notice Compute the challenge window length for an agent's reputation
    /// @param rep The agent's current reputation
    /// @return The challenge window in seconds
    /// @dev Converts only nonnegative int32 values through uint32. Negative values are widened to int64 before negation to avoid int32 minimum-value overflow.
    function computeWindow(int32 rep) internal pure returns (uint64) {
        if (rep <= 0) {
            int64 wide = -int64(rep);
            uint64 absRep = uint64(wide);
            return BASE_WINDOW + absRep * WINDOW_SLOPE;
        }

        uint64 delta = uint64(uint32(rep)) * WINDOW_SLOPE;
        if (delta >= BASE_WINDOW - MIN_WINDOW) {
            return MIN_WINDOW;
        }

        return BASE_WINDOW - delta;
    }

    /// @notice Compute the per-payment limit for an agent's reputation
    /// @param rep The agent's current reputation
    /// @return The per-payment limit in wei
    /// @dev Negative values return half the base limit before any uint conversion. Nonnegative int32 values convert safely through uint32 before widening to uint128.
    function computeLimit(int32 rep) internal pure returns (uint128) {
        if (rep < 0) {
            return BASE_LIMIT / 2;
        }

        uint128 delta = uint128(uint32(rep)) * LIMIT_SLOPE;
        uint128 candidate = BASE_LIMIT + delta;
        if (candidate > MAX_LIMIT) {
            return MAX_LIMIT;
        }

        return candidate;
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AutoDriveUSDCReceiver} from "../src/AutoDriveUSDCReceiver.sol";

/// @dev Minimal mintable USDC-like token (6 decimals) for tests.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Token that burns a 1% fee on every transfer, so the recipient receives
///      less than `value`. Used to prove the receiver emits the actual delta.
contract FeeOnTransferERC20 is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1%

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 0) {
            uint256 fee = (value * FEE_BPS) / 10000;
            super._update(from, to, value - fee);
            if (fee > 0) {
                super._update(from, address(0), fee); // burn the fee
            }
        } else {
            super._update(from, to, value);
        }
    }
}

/// @dev Token whose transfer re-enters the receiver to exercise the
///      ReentrancyGuard on payIntentWithToken.
contract ReentrantERC20 is ERC20 {
    AutoDriveUSDCReceiver public receiver;
    bool public attack;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setReceiver(AutoDriveUSDCReceiver receiver_) external {
        receiver = receiver_;
    }

    function setAttack(bool attack_) external {
        attack = attack_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (attack && to == address(receiver)) {
            attack = false; // single shot — the guard will revert this call
            receiver.payIntentWithToken(bytes32(uint256(1)), value);
        }
        super._update(from, to, value);
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

contract AutoDriveTreasury is Ownable2Step, ReentrancyGuard {
    // ExistentialDeposit deposit amount for Mainnet Auto-EVM
    uint256 public minimumBalance = 1e12 wei;

    event FundsWithdrawn(address indexed recipient, uint256 amount);
    event MinimumBalanceUpdated(
        uint256 oldMinimumBalance,
        uint256 newMinimumBalance
    );

    error InsufficientBalance(uint256 balance, uint256 minimumRequired);
    error InvalidRecipient(address recipient);
    error InvalidMinimumBalance(uint256 minimumBalance);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Allows the owner to withdraw all funds leaving at least the minimum balance
     * @param recipient The address to receive the withdrawn funds
     */
    function withdraw(address payable recipient) public onlyOwner nonReentrant {
        if (recipient == address(0)) {
            revert InvalidRecipient(recipient);
        }

        uint256 balance = address(this).balance;
        if (balance < minimumBalance) {
            revert InsufficientBalance(balance, minimumBalance);
        }

        uint256 withdrawAmount = balance - minimumBalance;
        if (withdrawAmount == 0) {
            revert InsufficientBalance(balance, minimumBalance);
        }

        Address.sendValue(recipient, withdrawAmount);
        emit FundsWithdrawn(recipient, withdrawAmount);
    }

    /**
     * @notice Allows the owner to update the minimum balance requirement
     * @param newMinimumBalance The new minimum balance to maintain
     */
    function setMinimumBalance(uint256 newMinimumBalance) public onlyOwner {
        if (newMinimumBalance > address(this).balance) {
            revert InvalidMinimumBalance(newMinimumBalance);
        }

        uint256 oldMinimumBalance = minimumBalance;
        minimumBalance = newMinimumBalance;
        emit MinimumBalanceUpdated(oldMinimumBalance, newMinimumBalance);
    }

    /**
     * @notice Allows the contract to receive ETH
     */
    receive() external payable {}
}

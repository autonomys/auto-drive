// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";


contract AutoDriveCreditsReceiver is Ownable2Step, ReentrancyGuard, Pausable {
    address payable public treasury;
    uint256 public minimumBalance;

    constructor(address initialOwner, address payable initialTreasury, uint256 initialMinimumBalance) Ownable(initialOwner) {
        treasury = initialTreasury;
        minimumBalance = initialMinimumBalance;
    }
    
    event IntentPaymentReceived(bytes32 indexed intentId, uint256 paymentAmount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event SweptToTreasury(address indexed caller, address indexed treasury, uint256 amount);

    error InvalidAmount(uint256 amount);
    error InvalidTreasury(address treasury);
    error InsufficientBalance(uint256 balance, uint256 minimumBalance, uint256 amount);

    function payIntent(bytes32 intentId) public payable whenNotPaused {
        if (msg.value == 0) {
            revert InvalidAmount(msg.value);
        }
        emit IntentPaymentReceived(intentId, msg.value);
    }

    function setTreasury(address payable newTreasury) public onlyOwner {
        if (newTreasury == address(0)) {
            revert InvalidTreasury(newTreasury);
        }
        address payable old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function sweepAmountToTreasury(uint256 amount) public nonReentrant whenNotPaused {
        if (treasury == address(0)) {
            revert InvalidTreasury(treasury);
        }
        if (amount == 0) {
            revert InvalidAmount(amount);
        }
        if (amount + minimumBalance > address(this).balance) {
            revert InsufficientBalance(address(this).balance, minimumBalance, amount);
        }
        Address.sendValue(treasury, amount);
        emit SweptToTreasury(msg.sender, treasury, amount);
    }

    function sweepAllToTreasury() public nonReentrant whenNotPaused {
        if (treasury == address(0)) {
            revert InvalidTreasury(treasury);
        }
        if (address(this).balance < minimumBalance) {
            // amount is 0 because we are sweeping all
            revert InsufficientBalance(address(this).balance, minimumBalance, 0);
        }
        uint256 balance = address(this).balance - minimumBalance;
        Address.sendValue(treasury, balance);
        emit SweptToTreasury(msg.sender, treasury, balance);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }
}

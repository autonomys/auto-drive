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

    function payIntent(bytes32 intentId) public payable whenNotPaused {
        require(msg.value > 0, "Amount must be > 0");
        emit IntentPaymentReceived(intentId, msg.value);
    }

    function setTreasury(address payable newTreasury) public onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        address payable old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function sweepAmountToTreasury(uint256 amount) public nonReentrant whenNotPaused {
        require(treasury != address(0), "Treasury not set");
        require(amount > 0, "Amount must be > 0");
        require(amount + minimumBalance <= address(this).balance, "Insufficient balance");
        Address.sendValue(treasury, amount);
        emit SweptToTreasury(msg.sender, treasury, amount);
    }

    function sweepAllToTreasury() public nonReentrant whenNotPaused {
        require(treasury != address(0), "Treasury not set");
        require(address(this).balance >= minimumBalance, "Insufficient balance");
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

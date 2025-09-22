// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";


contract AutoDriveCreditsReceiver is Ownable2Step, ReentrancyGuard, Pausable {
    constructor() Ownable(msg.sender) {}
    
    event Deposit(bytes32 indexed intentId, uint256 depositAmount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event SweptToTreasury(address indexed caller, uint256 amount);

    address payable public treasury;

    function deposit(bytes32 intentId) public payable whenNotPaused {
        emit Deposit(intentId, msg.value);
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
        require(amount <= address(this).balance, "Insufficient balance");
        Address.sendValue(treasury, amount);
        emit SweptToTreasury(msg.sender, amount);
    }

    function sweepAllToTreasury() public nonReentrant whenNotPaused {
        require(treasury != address(0), "Treasury not set");
        uint256 balance = address(this).balance;
        Address.sendValue(treasury, balance);
        emit SweptToTreasury(msg.sender, balance);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }
}

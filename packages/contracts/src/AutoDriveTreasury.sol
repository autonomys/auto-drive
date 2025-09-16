// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";


contract AutoDriveTreasury is Ownable2Step, ReentrancyGuard {
    constructor() Ownable(msg.sender) {}
    
    event Deposit(bytes32 indexed intentId, uint256 depositAmount);

    function deposit(bytes32 intentId) public payable {
        emit Deposit(intentId, msg.value);
    }

    function withdraw(uint256 amount) public onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(amount <= address(this).balance, "Insufficient balance");
        // Send to the EOA that initiated the transaction to avoid reverts on non-payable contracts
        Address.sendValue(payable(tx.origin), amount);
    }

    function withdrawAll() public onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        // Avoid nested nonReentrant by performing the transfer here
        Address.sendValue(payable(tx.origin), balance);
    }
}

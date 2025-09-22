// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import { AutoDriveTreasury } from "../src/AutoDriveTreasury.sol";

contract CounterTest is Test {
    AutoDriveTreasury public counter;

    function setUp() public {
        counter = new AutoDriveTreasury();
    }

    function testIncrement() public {
        bytes32 intentId = bytes32(0);
        counter = new AutoDriveTreasury();
        uint256 num = address(counter).balance;
        counter.deposit{value: 100 ether}(intentId);
        assertEq(address(counter).balance, num + 100 ether);
    }

    function testWithdraw() public {
        counter = new AutoDriveTreasury();
        counter.deposit{value: 100 ether}(bytes32(0));
        counter.withdraw(100 ether);
        assertEq(address(counter).balance, 0);
    }

    function testWithdrawAll() public {
        counter = new AutoDriveTreasury();
        counter.deposit{value: 100 ether}(bytes32(0));
        counter.withdrawAll();
        assertEq(address(counter).balance, 0);
    }

    function testTwoStepOwnershipTransfer() public {
        counter = new AutoDriveTreasury();
        address initialOwner = address(this);
        address newOwner = address(0xBEEF);
        address stranger = address(0xCAFE);

        // Initiate two-step transfer
        counter.transferOwnership(newOwner);
        assertEq(counter.owner(), initialOwner);
        assertEq(counter.pendingOwner(), newOwner);

        // Only pending owner can accept
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        counter.acceptOwnership();

        // Pending owner accepts
        vm.prank(newOwner);
        counter.acceptOwnership();
        assertEq(counter.owner(), newOwner);
        assertEq(counter.pendingOwner(), address(0));

        // Old owner can no longer use onlyOwner
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, initialOwner));
        counter.transferOwnership(stranger);

        // New owner can initiate new transfer
        vm.prank(newOwner);
        counter.transferOwnership(stranger);
        assertEq(counter.pendingOwner(), stranger);
    }


    receive() external payable {
        // Do nothing
    }
}

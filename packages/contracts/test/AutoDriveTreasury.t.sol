// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import { AutoDriveTreasury } from "../src/AutoDriveTreasury.sol";

contract AutoDriveTreasuryTest is Test {
    AutoDriveTreasury public autoDriveTreasury;

    function setUp() public {
        autoDriveTreasury = new AutoDriveTreasury();
    }

    function testIncrement() public {
        bytes32 intentId = bytes32(0);
        autoDriveTreasury = new AutoDriveTreasury();
        uint256 num = address(autoDriveTreasury).balance;
        autoDriveTreasury.deposit{value: 100 ether}(intentId);
        assertEq(address(autoDriveTreasury).balance, num + 100 ether);
    }

    function testWithdraw() public {
        autoDriveTreasury = new AutoDriveTreasury();
        autoDriveTreasury.deposit{value: 100 ether}(bytes32(0));
        autoDriveTreasury.withdraw(100 ether);
        assertEq(address(autoDriveTreasury).balance, 0);
    }

    function testWithdrawAll() public {
        autoDriveTreasury = new AutoDriveTreasury();
        autoDriveTreasury.deposit{value: 100 ether}(bytes32(0));
        autoDriveTreasury.withdrawAll();
        assertEq(address(autoDriveTreasury).balance, 0);
    }

    function testTwoStepOwnershipTransfer() public {
        autoDriveTreasury = new AutoDriveTreasury();
        address initialOwner = address(this);
        address newOwner = address(0xBEEF);
        address stranger = address(0xCAFE);

        // Initiate two-step transfer
        autoDriveTreasury.transferOwnership(newOwner);
        assertEq(autoDriveTreasury.owner(), initialOwner);
        assertEq(autoDriveTreasury.pendingOwner(), newOwner);

        // Only pending owner can accept
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        autoDriveTreasury.acceptOwnership();

        // Pending owner accepts
        vm.prank(newOwner);
        autoDriveTreasury.acceptOwnership();
        assertEq(autoDriveTreasury.owner(), newOwner);
        assertEq(autoDriveTreasury.pendingOwner(), address(0));

        // Old owner can no longer use onlyOwner
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, initialOwner));
        autoDriveTreasury.transferOwnership(stranger);

        // New owner can initiate new transfer
        vm.prank(newOwner);
        autoDriveTreasury.transferOwnership(stranger);
        assertEq(autoDriveTreasury.pendingOwner(), stranger);
    }


    receive() external payable {
        // Do nothing
    }
}

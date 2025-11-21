// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AutoDriveTreasury} from "../src/AutoDriveTreasury.sol";

contract AutoDriveTreasuryTest is Test {
    AutoDriveTreasury public treasury;

    function setUp() public {
        treasury = new AutoDriveTreasury(address(this));
    }

    function testWithdrawSuccessLeavesMinimumBalance() public {
        uint256 min = treasury.minimumBalance();
        uint256 fundAmount = min + 3 ether;

        // fund contract
        (bool ok, ) = payable(address(treasury)).call{value: fundAmount}("");
        assertTrue(ok);

        address payable recipient = payable(address(0xB0B));
        uint256 beforeRecipient = recipient.balance;

        treasury.withdraw(recipient);

        assertEq(address(treasury).balance, min);
        assertEq(recipient.balance, beforeRecipient + (fundAmount - min));
    }

    function testWithdrawRevertsWhenBalanceLTEMinimum() public {
        uint256 min = treasury.minimumBalance();

        // fund to exactly minimum
        (bool ok, ) = payable(address(treasury)).call{value: min}("");
        assertTrue(ok);

        address payable recipient = payable(address(0xB0B));

        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveTreasury.InsufficientBalance.selector,
                address(treasury).balance,
                min
            )
        );
        treasury.withdraw(recipient);
    }

    function testWithdrawRevertsOnZeroRecipient() public {
        uint256 min = treasury.minimumBalance();
        uint256 fundAmount = min + 1 ether;
        (bool ok, ) = payable(address(treasury)).call{value: fundAmount}("");
        assertTrue(ok);

        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveTreasury.InvalidRecipient.selector,
                address(0)
            )
        );
        treasury.withdraw(payable(address(0)));
    }

    function testTwoStepOwnershipTransfer() public {
        address initialOwner = address(this);
        address newOwner = address(0xBEEF);
        address stranger = address(0xCAFE);

        // Initiate two-step transfer
        treasury.transferOwnership(newOwner);
        assertEq(treasury.owner(), initialOwner);
        assertEq(treasury.pendingOwner(), newOwner);

        // Only pending owner can accept
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                stranger
            )
        );
        treasury.acceptOwnership();

        // Pending owner accepts
        vm.prank(newOwner);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), newOwner);
        assertEq(treasury.pendingOwner(), address(0));

        // Old owner can no longer use onlyOwner
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                initialOwner
            )
        );
        treasury.transferOwnership(stranger);

        // New owner can initiate new transfer
        vm.prank(newOwner);
        treasury.transferOwnership(stranger);
        assertEq(treasury.pendingOwner(), stranger);
    }

    function testSetMinimumBalanceUpdatesAndRevertsIfAboveBalance() public {
        // balance initially 0, so only 0 is allowed
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveTreasury.InvalidMinimumBalance.selector,
                1
            )
        );
        treasury.setMinimumBalance(1);

        // fund and then set to a value <= balance
        (bool ok, ) = payable(address(treasury)).call{value: 2 ether}("");
        assertTrue(ok);

        uint256 oldMin = treasury.minimumBalance();
        uint256 newMin = 1 ether;
        treasury.setMinimumBalance(newMin);
        assertEq(treasury.minimumBalance(), newMin);

        // sanity: minimum changed from previous
        assertTrue(oldMin != newMin);
    }

    receive() external payable {}
}

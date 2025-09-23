// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import { AutoDriveCreditsReceiver } from "../src/AutoDriveCreditsReceiver.sol";
import { RevertingTreasury, AcceptingTreasury } from "./utils.sol";

contract AutoDriveTreasuryTest is Test {
    AutoDriveCreditsReceiver public autoDriveCreditsReceiver;
    address payable public treasury = payable(address(0xB0B));

    function setUp() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
    }

    function testPayIntent() public {
        bytes32 intentId = bytes32(0);
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        uint256 num = address(autoDriveCreditsReceiver).balance;
        autoDriveCreditsReceiver.payIntent{value: 100 ether}(intentId);
        assertEq(address(autoDriveCreditsReceiver).balance, num + 100 ether);
    }

    function testTwoStepOwnershipTransfer() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        address initialOwner = address(this);
        address newOwner = address(0xBEEF);
        address stranger = address(0xCAFE);

        // Initiate two-step transfer
        autoDriveCreditsReceiver.transferOwnership(newOwner);
        assertEq(autoDriveCreditsReceiver.owner(), initialOwner);
        assertEq(autoDriveCreditsReceiver.pendingOwner(), newOwner);

        // Only pending owner can accept
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        autoDriveCreditsReceiver.acceptOwnership();

        // Pending owner accepts
        vm.prank(newOwner);
        autoDriveCreditsReceiver.acceptOwnership();
        assertEq(autoDriveCreditsReceiver.owner(), newOwner);
        assertEq(autoDriveCreditsReceiver.pendingOwner(), address(0));

        // Old owner can no longer use onlyOwner
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, initialOwner));
        autoDriveCreditsReceiver.transferOwnership(stranger);

        // New owner can initiate new transfer
        vm.prank(newOwner);
        autoDriveCreditsReceiver.transferOwnership(stranger);
        assertEq(autoDriveCreditsReceiver.pendingOwner(), stranger);
    }


    function testSetTreasuryOnlyOwnerAndZeroAddressReverts() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);

        address payable newTreasury = payable(address(0x1234));

        // onlyOwner
        address stranger = address(0xCAFE);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        autoDriveCreditsReceiver.setTreasury(newTreasury);

        // zero address revert
        vm.expectRevert(abi.encodeWithSelector(AutoDriveCreditsReceiver.InvalidTreasury.selector, address(0)));
        autoDriveCreditsReceiver.setTreasury(payable(address(0)));

        // success
        autoDriveCreditsReceiver.setTreasury(newTreasury);
        assertEq(autoDriveCreditsReceiver.treasury(), newTreasury);
    }

    function testSetTreasuryRevertsWhenContractRejectsZeroValueCall() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        RevertingTreasury bad = new RevertingTreasury();
        vm.expectRevert(abi.encodeWithSelector(AutoDriveCreditsReceiver.InvalidTreasury.selector, address(bad)));
        autoDriveCreditsReceiver.setTreasury(payable(address(bad)));
    }

    function testSetTreasuryAcceptsContractHandlingZeroValueCall() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        AcceptingTreasury good = new AcceptingTreasury();
        autoDriveCreditsReceiver.setTreasury(payable(address(good)));
        assertEq(autoDriveCreditsReceiver.treasury(), payable(address(good)));
    }

    function testSweepAmountPermissionlessSuccess() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        autoDriveCreditsReceiver.payIntent{value: 5 ether}(bytes32(0));

        address caller = address(0xCAFE);
        uint256 treasuryBefore = treasury.balance;
        uint256 amount = 2 ether;

        vm.prank(caller);
        autoDriveCreditsReceiver.sweepAmountToTreasury(amount);

        assertEq(address(autoDriveCreditsReceiver).balance, 3 ether);
        assertEq(treasury.balance, treasuryBefore + amount);
    }

    function testSweepAllPermissionlessSuccess() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        autoDriveCreditsReceiver.payIntent{value: 3 ether}(bytes32(0));

        address caller = address(0xD00D);
        uint256 treasuryBefore = treasury.balance;

        vm.prank(caller);
        autoDriveCreditsReceiver.sweepAllToTreasury();

        assertEq(address(autoDriveCreditsReceiver).balance, 0);
        assertEq(treasury.balance, treasuryBefore + 3 ether);
    }

    function testSweepRevertsInvalidAmountOrInsufficientBalance() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        autoDriveCreditsReceiver.payIntent{value: 1 ether}(bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(AutoDriveCreditsReceiver.InvalidAmount.selector, 0));
        autoDriveCreditsReceiver.sweepAmountToTreasury(0);

        vm.expectRevert(abi.encodeWithSelector(AutoDriveCreditsReceiver.InsufficientBalance.selector, address(autoDriveCreditsReceiver).balance, 0, 2 ether));
        autoDriveCreditsReceiver.sweepAmountToTreasury(2 ether);
    }

    function testPauseUnpauseOnlyOwner() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);
        address stranger = address(0xCAFE);

        // onlyOwner: pause
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        autoDriveCreditsReceiver.pause();

        // onlyOwner: unpause
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        autoDriveCreditsReceiver.unpause();

        // owner can pause
        autoDriveCreditsReceiver.pause();
        assertTrue(autoDriveCreditsReceiver.paused());

        // owner can unpause
        autoDriveCreditsReceiver.unpause();
        assertFalse(autoDriveCreditsReceiver.paused());
    }

    function testPayIntentAndSweepRevertWhenPaused() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 0);

        // pause
        autoDriveCreditsReceiver.pause();

        // payIntent reverts when paused
        vm.expectRevert(Pausable.EnforcedPause.selector);
        autoDriveCreditsReceiver.payIntent{value: 1 ether}(bytes32(0));

        // unpause, set treasury and fund
        autoDriveCreditsReceiver.unpause();
        autoDriveCreditsReceiver.payIntent{value: 2 ether}(bytes32(0));

        // pause again, sweeping should revert when paused
        autoDriveCreditsReceiver.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        autoDriveCreditsReceiver.sweepAmountToTreasury(1 ether);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        autoDriveCreditsReceiver.sweepAllToTreasury();
    }

    function testSweepAllWithMinimumBalanceAndEnoughBalance() public {
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, 1 ether);
        autoDriveCreditsReceiver.payIntent{value: 2 ether}(bytes32(0));

        uint256 treasuryBefore = treasury.balance;
        autoDriveCreditsReceiver.sweepAllToTreasury();
        assertEq(address(autoDriveCreditsReceiver).balance, 1 ether);
        assertEq(treasury.balance, treasuryBefore + 1 ether);
    }

    function testSweepAllWithMinimumBalanceAndNotEnoughBalance() public {
        uint256 minimumBalance = 2 ether;
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, minimumBalance);
        autoDriveCreditsReceiver.payIntent{value: 1 ether}(bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(AutoDriveCreditsReceiver.InsufficientBalance.selector, address(autoDriveCreditsReceiver).balance, minimumBalance, 0));
        autoDriveCreditsReceiver.sweepAllToTreasury();
    }

    function testSweepAmountWithMinimumBalanceAndNotEnoughBalance() public {
        uint256 minimumBalance = 1 ether;
        autoDriveCreditsReceiver = new AutoDriveCreditsReceiver(address(this), treasury, minimumBalance);
        autoDriveCreditsReceiver.payIntent{value: 2 ether}(bytes32(0));

        uint256 withdrawAmount = 2 ether;
        vm.expectRevert(abi.encodeWithSelector(AutoDriveCreditsReceiver.InsufficientBalance.selector, address(autoDriveCreditsReceiver).balance, minimumBalance, withdrawAmount));
        autoDriveCreditsReceiver.sweepAmountToTreasury(withdrawAmount);
    }


    receive() external payable {
        // Do nothing
    }
}


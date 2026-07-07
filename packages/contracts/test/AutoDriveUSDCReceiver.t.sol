// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AutoDriveUSDCReceiver} from "../src/AutoDriveUSDCReceiver.sol";
import {MockERC20, FeeOnTransferERC20, ReentrantERC20} from "./mocks.sol";

contract AutoDriveUSDCReceiverTest is Test {
    AutoDriveUSDCReceiver public receiver;
    MockERC20 public usdc;

    address public owner = address(this);
    address public payer = address(0xA11CE);
    address public recipient = address(0xBEEF);
    address public stranger = address(0xCAFE);

    bytes32 public constant INTENT_ID = bytes32(uint256(0xABCD));

    // Re-declared to assert emission with vm.expectEmit.
    event IntentTokenPaymentReceived(
        bytes32 indexed intentId,
        address token,
        uint256 amount,
        address indexed payer
    );
    event Swept(address indexed caller, address indexed to, uint256 amount);

    function setUp() public {
        usdc = new MockERC20();
        receiver = new AutoDriveUSDCReceiver(owner, IERC20(address(usdc)));
        usdc.mint(payer, 1_000_000_000); // 1,000 USDC
    }

    // --- constructor -------------------------------------------------------

    function testConstructorRevertsOnZeroToken() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveUSDCReceiver.InvalidToken.selector,
                address(0)
            )
        );
        new AutoDriveUSDCReceiver(owner, IERC20(address(0)));
    }

    function testConstructorRevertsOnNonContractToken() public {
        // An EOA (no code) must be rejected as the token.
        address eoa = address(0x1234);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveUSDCReceiver.InvalidToken.selector,
                eoa
            )
        );
        new AutoDriveUSDCReceiver(owner, IERC20(eoa));
    }

    function testTokenIsImmutable() public view {
        assertEq(address(receiver.token()), address(usdc));
    }

    // --- payIntentWithToken ------------------------------------------------

    function testPayIntentWithTokenHappyPath() public {
        uint256 amount = 5_000_000; // 5 USDC

        vm.prank(payer);
        usdc.approve(address(receiver), amount);

        vm.expectEmit(true, true, false, true);
        emit IntentTokenPaymentReceived(INTENT_ID, address(usdc), amount, payer);

        vm.prank(payer);
        receiver.payIntentWithToken(INTENT_ID, amount);

        assertEq(usdc.balanceOf(address(receiver)), amount);
    }

    function testPayIntentRevertsWithoutApproval() public {
        vm.prank(payer);
        vm.expectRevert(); // ERC20InsufficientAllowance
        receiver.payIntentWithToken(INTENT_ID, 5_000_000);
    }

    function testPayIntentRevertsWithoutBalance() public {
        // poorPayer approves but holds no tokens.
        address poorPayer = address(0xD00D);
        vm.prank(poorPayer);
        usdc.approve(address(receiver), 5_000_000);

        vm.prank(poorPayer);
        vm.expectRevert(); // ERC20InsufficientBalance
        receiver.payIntentWithToken(INTENT_ID, 5_000_000);
    }

    function testPayIntentRevertsOnZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveUSDCReceiver.InvalidAmount.selector,
                0
            )
        );
        receiver.payIntentWithToken(INTENT_ID, 0);
    }

    function testPayIntentRevertsWhenPaused() public {
        receiver.pause();

        vm.prank(payer);
        usdc.approve(address(receiver), 5_000_000);

        vm.prank(payer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        receiver.payIntentWithToken(INTENT_ID, 5_000_000);
    }

    function testPayIntentEmitsActualReceivedForFeeOnTransferToken() public {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20();
        AutoDriveUSDCReceiver feeReceiver = new AutoDriveUSDCReceiver(
            owner,
            IERC20(address(feeToken))
        );

        uint256 amount = 1_000_000;
        uint256 fee = (amount * feeToken.FEE_BPS()) / 10000;
        uint256 received = amount - fee;

        feeToken.mint(payer, amount);
        vm.prank(payer);
        feeToken.approve(address(feeReceiver), amount);

        // Event carries the real delta (received), not the requested amount.
        vm.expectEmit(true, true, false, true);
        emit IntentTokenPaymentReceived(
            INTENT_ID,
            address(feeToken),
            received,
            payer
        );

        vm.prank(payer);
        feeReceiver.payIntentWithToken(INTENT_ID, amount);

        assertEq(feeToken.balanceOf(address(feeReceiver)), received);
    }

    function testPayIntentReentrancyReverts() public {
        ReentrantERC20 evil = new ReentrantERC20();
        AutoDriveUSDCReceiver evilReceiver = new AutoDriveUSDCReceiver(
            owner,
            IERC20(address(evil))
        );
        evil.setReceiver(evilReceiver);
        evil.mint(payer, 10_000_000);

        vm.prank(payer);
        evil.approve(address(evilReceiver), 10_000_000);

        evil.setAttack(true);

        vm.prank(payer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        evilReceiver.payIntentWithToken(INTENT_ID, 5_000_000);
    }

    // --- sweep / sweepAll --------------------------------------------------

    function _fund(uint256 amount) internal {
        vm.prank(payer);
        usdc.approve(address(receiver), amount);
        vm.prank(payer);
        receiver.payIntentWithToken(INTENT_ID, amount);
    }

    function testSweepOnlyOwner() public {
        _fund(5_000_000);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                stranger
            )
        );
        receiver.sweep(recipient, 1_000_000);
    }

    function testSweepHappyPath() public {
        _fund(5_000_000);
        uint256 amount = 2_000_000;

        vm.expectEmit(true, true, false, true);
        emit Swept(owner, recipient, amount);

        receiver.sweep(recipient, amount);

        assertEq(usdc.balanceOf(recipient), amount);
        assertEq(usdc.balanceOf(address(receiver)), 3_000_000);
    }

    function testSweepRevertsOnZeroRecipient() public {
        _fund(5_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveUSDCReceiver.InvalidRecipient.selector,
                address(0)
            )
        );
        receiver.sweep(address(0), 1_000_000);
    }

    function testSweepRevertsOnZeroAmount() public {
        _fund(5_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveUSDCReceiver.InvalidAmount.selector,
                0
            )
        );
        receiver.sweep(recipient, 0);
    }

    function testSweepRevertsOnInsufficientBalance() public {
        _fund(1_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveUSDCReceiver.InsufficientBalance.selector,
                1_000_000,
                2_000_000
            )
        );
        receiver.sweep(recipient, 2_000_000);
    }

    function testSweepAllHappyPath() public {
        _fund(5_000_000);

        vm.expectEmit(true, true, false, true);
        emit Swept(owner, recipient, 5_000_000);

        receiver.sweepAll(recipient);

        assertEq(usdc.balanceOf(address(receiver)), 0);
        assertEq(usdc.balanceOf(recipient), 5_000_000);
    }

    function testSweepAllRevertsWhenEmpty() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                AutoDriveUSDCReceiver.InsufficientBalance.selector,
                0,
                0
            )
        );
        receiver.sweepAll(recipient);
    }

    function testSweepWorksWhilePaused() public {
        _fund(5_000_000);
        receiver.pause();

        // Deliberate: owner can always move funds to safety while paused.
        receiver.sweep(recipient, 1_000_000);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    // --- pause / ownership -------------------------------------------------

    function testPauseUnpauseOnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                stranger
            )
        );
        receiver.pause();

        receiver.pause();
        assertTrue(receiver.paused());

        receiver.unpause();
        assertFalse(receiver.paused());
    }

    function testTwoStepOwnershipTransfer() public {
        address newOwner = address(0xBEEF);

        receiver.transferOwnership(newOwner);
        assertEq(receiver.owner(), owner);
        assertEq(receiver.pendingOwner(), newOwner);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                stranger
            )
        );
        receiver.acceptOwnership();

        vm.prank(newOwner);
        receiver.acceptOwnership();
        assertEq(receiver.owner(), newOwner);
        assertEq(receiver.pendingOwner(), address(0));
    }

    function testRenounceOwnershipDisabled() public {
        vm.expectRevert(
            AutoDriveUSDCReceiver.RenounceOwnershipDisabled.selector
        );
        receiver.renounceOwnership();
        assertEq(receiver.owner(), owner);
    }

    function testRenounceOwnershipOnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                stranger
            )
        );
        receiver.renounceOwnership();
    }
}

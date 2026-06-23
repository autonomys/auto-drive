// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AutoDriveUSDCReceiver
 * @notice ERC20 (USDC) counterpart of AutoDriveCreditsReceiver, for paying
 *         credit-purchase intents with a token on Ethereum. The backend watches
 *         IntentTokenPaymentReceived and grants credits at the intent's locked
 *         USD price (deferred-conversion / "Option C").
 * @dev Differs from the native receiver in three deliberate ways:
 *      - Accepts a single, immutable ERC20 token (redeploy for a different
 *        token/chain) rather than native value.
 *      - Emits the `payer` in the event instead of relying on the tx sender,
 *        because ERC20 payments can be relayed by a third party.
 *      - Sweeps are owner-gated to a caller-specified recipient (not a fixed
 *        treasury), so funds can later be routed to a swapper contract. There is
 *        no `minimumBalance` — that exists only for Auto-EVM's existential
 *        deposit and is meaningless for an ERC20 balance on Ethereum.
 */
contract AutoDriveUSDCReceiver is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice The ERC20 token accepted for payment (USDC on the target chain).
    IERC20 public immutable token;

    event IntentTokenPaymentReceived(
        bytes32 indexed intentId,
        address token,
        uint256 amount,
        address indexed payer
    );
    event Swept(address indexed caller, address indexed to, uint256 amount);

    error InvalidAmount(uint256 amount);
    error InvalidToken(address token);
    error InvalidRecipient(address recipient);
    error InsufficientBalance(uint256 balance, uint256 amount);

    constructor(address initialOwner, IERC20 token_) Ownable(initialOwner) {
        if (address(token_) == address(0)) {
            revert InvalidToken(address(token_));
        }
        token = token_;
    }

    /**
     * @notice Pay an intent with the configured ERC20 token. The caller must
     *         have approved this contract for at least `amount` beforehand.
     * @param intentId The intent being paid.
     * @param amount   The token amount to pull from the caller (token's smallest
     *                  unit; USDC has 6 decimals).
     * @dev The amount carried in the event is the *actual* balance delta
     *      received, so a fee-on-transfer token can never cause the backend to
     *      over-credit. `nonReentrant` guards against tokens with transfer
     *      callbacks.
     */
    function payIntentWithToken(bytes32 intentId, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) {
            revert InvalidAmount(amount);
        }

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;

        if (received == 0) {
            revert InvalidAmount(received);
        }

        emit IntentTokenPaymentReceived(
            intentId,
            address(token),
            received,
            msg.sender
        );
    }

    /**
     * @notice Owner sweeps `amount` of the token to `to`.
     * @dev onlyOwner because the destination is caller-specified; `to` may later
     *      be a swapper contract. Intentionally callable while paused so the
     *      owner can always move funds to safety during an incident.
     */
    function sweep(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) {
            revert InvalidRecipient(to);
        }
        if (amount == 0) {
            revert InvalidAmount(amount);
        }

        uint256 balance = token.balanceOf(address(this));
        if (amount > balance) {
            revert InsufficientBalance(balance, amount);
        }

        token.safeTransfer(to, amount);
        emit Swept(msg.sender, to, amount);
    }

    /**
     * @notice Owner sweeps the entire token balance to `to`.
     */
    function sweepAll(address to) external onlyOwner nonReentrant {
        if (to == address(0)) {
            revert InvalidRecipient(to);
        }

        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) {
            revert InsufficientBalance(balance, 0);
        }

        token.safeTransfer(to, balance);
        emit Swept(msg.sender, to, balance);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

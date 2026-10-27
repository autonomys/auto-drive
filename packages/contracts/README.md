## AutoDriveCreditsReceiver

**Purpose**: Minimal AI3 receiver that tags incoming deposits with an `intentId` and later sweeps funds to a designated treasury. Owner can pause operations and update the treasury using two-step ownership.

### Inheritance

- `Ownable2Step`
- `ReentrancyGuard`
- `Pausable`

### State

- `address payable public treasury` — destination for swept funds. Must be set by the owner before sweeping.

### Events

- `IntentPaymentReceived(bytes32 indexed intentId, uint256 depositAmount)` — emitted on each deposit with the provided intent identifier.
- `TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury)` — emitted when the owner updates the treasury.
- `SweptToTreasury(address indexed caller, uint256 amount)` — emitted when funds are swept to the treasury.

### Functions

- `payIntent(bytes32 intentId) public payable whenNotPaused`
  - Accepts AI3 and emits `IntentPaymentReceived` with the `intentId` and `msg.value`.
  - No minimum deposit enforced; caller supplies the payable value.

- `setTreasury(address payable newTreasury) public onlyOwner`
  - Sets the treasury address. Reverts if `newTreasury == address(0)`.
  - Emits `TreasuryUpdated(old, newTreasury)`.

- `sweepAmountToTreasury(uint256 amount) public nonReentrant whenNotPaused`
  - Transfers exactly `amount` of the contract's AI3 balance to `treasury`.
  - Reverts if treasury unset, amount is zero, or insufficient balance.
  - Emits `SweptToTreasury(msg.sender, treasury, amount)`.

- `sweepAllToTreasury() public nonReentrant whenNotPaused`
  - Transfers the entire AI3 balance to `treasury`.
  - Reverts if treasury unset.
  - Emits `SweptToTreasury(msg.sender, treasury, balance)`.

- `pause() public onlyOwner` / `unpause() public onlyOwner`
  - Halts/resumes `deposit` and sweep operations.

### Security Considerations

- Uses `ReentrancyGuard` for all sweep operations and OpenZeppelin `Address.sendValue` for safe AI3 transfers.
- `Pausable` allows the owner to quickly halt deposits and sweeping if needed.
- `Ownable2Step` reduces risk of accidental ownership transfers.
- Sweeping is permissionless (anyone may trigger) but only sends to the configured `treasury`.

### Typical Flow

1. Deploy contract (owner is deployer via `Ownable(msg.sender)` in constructor).
2. Owner calls `setTreasury(<treasury>)`.
3. Users call `deposit(intentId)` with `msg.value` set to the desired amount.
4. Anyone may call `sweepAllToTreasury()` or `sweepAmountToTreasury(amount)` to move funds to the treasury.
5. Owner may `pause()`/`unpause()` if needed.

### Notes

- Contract holds AI3 only; there are no token transfers.
- Ensure the `treasury` is a capable receiver (EOA or contract implementing a payable fallback/receive).

---

## AutoDriveTreasury

**Purpose**: Secure treasury contract that holds AI3 funds swept from `AutoDriveCreditsReceiver`. Only the owner can withdraw funds, and a minimum balance is retained to preserve the account's existential deposit on Auto-EVM.

### Inheritance

- `Ownable2Step`
- `ReentrancyGuard`

### State

- `uint256 public minimumBalance` — minimum balance to retain (default: 1e12 wei for Auto-EVM existential deposit).

### Events

- `FundsWithdrawn(address indexed recipient, uint256 amount)` — emitted when the owner withdraws funds.
- `MinimumBalanceUpdated(uint256 oldMinimumBalance, uint256 newMinimumBalance)` — emitted when the minimum balance is updated.

### Errors

- `InsufficientBalance(uint256 balance, uint256 minimumRequired)` — balance is at or below minimum.
- `InvalidRecipient(address recipient)` — recipient is zero address.
- `InvalidMinimumBalance(uint256 minimumBalance)` — new minimum exceeds current balance.

### Functions

- `withdraw(address payable recipient) public onlyOwner nonReentrant`
  - Withdraws all funds above `minimumBalance` to the specified recipient.
  - Reverts if recipient is zero address or balance is insufficient.
  - Emits `FundsWithdrawn(recipient, amount)`.

- `setMinimumBalance(uint256 newMinimumBalance) public onlyOwner`
  - Updates the minimum balance requirement.
  - Reverts if `newMinimumBalance` exceeds current contract balance.
  - Emits `MinimumBalanceUpdated(old, new)`.

- `receive() external payable`
  - Allows the contract to receive AI3 transfers.

### Security Considerations

- Uses `Ownable2Step` to prevent accidental ownership transfers.
- `ReentrancyGuard` protects the withdraw function.
- Maintains existential deposit to keep the account alive on Auto-EVM.

### Typical Flow

1. Deploy contract with initial owner.
2. Set as treasury in `AutoDriveCreditsReceiver` via `setTreasury()`.
3. Funds are swept from receiver to treasury.
4. Owner calls `withdraw(recipient)` to move funds to a cold wallet or operational account.

### Notes

- The `minimumBalance` default (1e12 wei) matches Auto-EVM's existential deposit requirement.
- Consider using a multisig as the owner for production deployments.

---

## AutoDriveUSDCReceiver

**Purpose**: ERC20 (USDC) counterpart of `AutoDriveCreditsReceiver`, for paying credit-purchase intents with a token on Ethereum. The backend watches `IntentTokenPaymentReceived` and grants credits at the intent's locked USD price (deferred-conversion / "Option C"). Owner can pause payments, sweep collected tokens to any recipient, and transfer ownership via two steps.

### Inheritance

- `Ownable2Step`
- `ReentrancyGuard`
- `Pausable`

### State

- `IERC20 public immutable token` — the accepted token (USDC), fixed at deploy. Redeploy for a different token/chain.

### Events

- `IntentTokenPaymentReceived(bytes32 indexed intentId, address token, uint256 amount, address indexed payer)` — emitted on each payment. `amount` is the **actual balance delta received**; `payer` is carried in the event (not read from the tx sender) because ERC20 payments can be relayed.
- `Swept(address indexed caller, address indexed to, uint256 amount)` — emitted when the owner sweeps tokens.

### Errors

- `InvalidAmount(uint256 amount)` — zero (or zero received) amount.
- `InvalidToken(address token)` — zero or non-contract token address at construction.
- `InvalidRecipient(address recipient)` — zero sweep recipient.
- `InsufficientBalance(uint256 balance, uint256 amount)` — sweep exceeds balance.
- `RenounceOwnershipDisabled()` — `renounceOwnership` is disabled (see below).

### Functions

- `payIntentWithToken(bytes32 intentId, uint256 amount) external nonReentrant whenNotPaused`
  - Pulls `amount` of `token` from the caller (who must have approved first) and emits `IntentTokenPaymentReceived` with the **actual received delta**, so a fee-on-transfer token can never cause over-crediting.

- `sweep(address to, uint256 amount) external onlyOwner nonReentrant`
  - Transfers `amount` of `token` to `to`. `onlyOwner` because the destination is caller-specified (`to` may later be a swapper contract). **Callable while paused** so the owner can always move funds to safety.

- `sweepAll(address to) external onlyOwner nonReentrant`
  - Transfers the entire `token` balance to `to`.

- `pause() external onlyOwner` / `unpause() external onlyOwner`
  - Halts/resumes `payIntentWithToken`.

- `renounceOwnership() public view override onlyOwner`
  - Always reverts with `RenounceOwnershipDisabled`. Renouncing ownership would permanently strand any tokens held by the contract, since sweeps are owner-gated.

### Security Considerations

- `SafeERC20` for all token transfers (does not assume a bool return); `ReentrancyGuard` on the pay and sweep paths.
- The constructor rejects a token address with no deployed code, catching typos and wrong-chain addresses at deploy time.
- `renounceOwnership` is disabled so the contract can never end up ownerless with stranded funds.
- No `minimumBalance`: that exists only for Auto-EVM's existential deposit and is meaningless for an ERC20 balance on Ethereum.
- Sweeps are `onlyOwner` (unlike the native receiver's permissionless sweep) because the destination is arbitrary — use a multisig owner in production.
- Permit2 / EIP-2612 (collapsing approve + pay into one signature) is intentionally deferred to a later iteration.

### Typical Flow

1. Deploy with `(initialOwner, token)`.
2. User calls `token.approve(receiver, amount)` then `payIntentWithToken(intentId, amount)`.
3. Backend confirms `IntentTokenPaymentReceived` and grants credits.
4. Owner periodically calls `sweep(to, amount)` / `sweepAll(to)` to move collected USDC to the treasury/swapper.

### Deploy

Uses `script/DeployAutoDriveUSDCReceiver.s.sol`. Required env: `PRIVATE_KEY`; optional `USDC_TOKEN_ADDRESS` (defaults to [Circle's canonical USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) on mainnet/Sepolia; required on other chains) and `OWNER` (defaults to deployer — use a multisig in production). The script verifies the token address has code on the target chain before deploying.

```bash
# Defaults: Ethereum mainnet 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
#           Sepolia          0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
PRIVATE_KEY=0x... OWNER=0x... \
  forge script script/DeployAutoDriveUSDCReceiver.s.sol \
  --rpc-url "$ETH_RPC_URL" --broadcast --verify
```

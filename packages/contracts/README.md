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

## AutoDriveCreditsReceiver

**Purpose**: Minimal ETH receiver that tags incoming deposits with an `intentId` and later sweeps funds to a designated treasury. Owner can pause operations and update the treasury using two-step ownership.

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
  - Accepts ETH and emits `IntentPaymentReceived` with the `intentId` and `msg.value`.
  - No minimum deposit enforced; caller supplies the payable value.

- `setTreasury(address payable newTreasury) public onlyOwner`
  - Sets the treasury address. Reverts if `newTreasury == address(0)`.
  - Emits `TreasuryUpdated(old, newTreasury)`.

- `sweepAmountToTreasury(uint256 amount) public nonReentrant whenNotPaused`
  - Transfers exactly `amount` of the contract's ETH balance to `treasury`.
  - Reverts if treasury unset, amount is zero, or insufficient balance.
  - Emits `SweptToTreasury(msg.sender, treasury, amount)`.

- `sweepAllToTreasury() public nonReentrant whenNotPaused`
  - Transfers the entire ETH balance to `treasury`.
  - Reverts if treasury unset.
  - Emits `SweptToTreasury(msg.sender, treasury, balance)`.

- `pause() public onlyOwner` / `unpause() public onlyOwner`
  - Halts/resumes `deposit` and sweep operations.

### Security Considerations

- Uses `ReentrancyGuard` for all sweep operations and OpenZeppelin `Address.sendValue` for safe ETH transfers.
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

- Contract holds ETH only; there are no token transfers.
- Ensure the `treasury` is a capable receiver (EOA or contract implementing a payable fallback/receive).

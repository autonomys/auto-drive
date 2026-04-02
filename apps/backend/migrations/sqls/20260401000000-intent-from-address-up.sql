-- Add from_address to intents table.
--
-- Captures the EVM wallet address that sent the on-chain payment so admins
-- can identify the payer and initiate refunds without needing to look up the
-- transaction externally. Populated by the payment manager when it processes
-- the TransactionReceipt for each confirmed intent.
--
-- Nullable because:
--   1. Existing intents confirmed before this migration have no stored address.
--   2. Intents that expire or fail before confirmation never receive a receipt.

ALTER TABLE intents ADD COLUMN from_address VARCHAR(255);

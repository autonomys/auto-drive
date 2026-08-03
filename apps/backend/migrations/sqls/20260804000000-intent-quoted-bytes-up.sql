-- Record the purchase size an intent was created for.
--
-- Until now an intent locked only a price per byte (shannons_per_byte) and the
-- size was reverse-derived after payment as payment_amount / shannons_per_byte.
-- That makes the per-user credit cap enforceable only after the money has
-- landed on-chain, and leaves nothing to quote a fixed-price purchase against.
--
-- quoted_bytes  — bytes the user asked to buy, captured at intent creation.
--
-- Nullable, and it must stay that way: every existing row predates the column,
-- and the native-AI3 flow may legitimately omit a size (the create endpoint
-- accepts a body-less request, which is what the current frontend sends).
--
-- numeric(78,0) matches the bigint base-unit convention already used by
-- payment_amount / shannons_per_byte and the token_* columns.
--
-- NOTE: this column is recorded but not yet authoritative — credits are still
-- derived from payment_amount / shannons_per_byte. Do not assume a non-NULL
-- quoted_bytes equals the credits an account received.

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS quoted_bytes numeric(78,0);

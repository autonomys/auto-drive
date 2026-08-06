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
-- accepts a body-less request, which is what the current frontend sends). The
-- USDC flow is the opposite — a Uniswap quote prices a specific size, so a USDC
-- intent with no quoted_bytes has no rate to lock and must be rejected at
-- creation rather than stored.
--
-- numeric(78,0) matches the bigint base-unit convention already used by
-- payment_amount / shannons_per_byte and the token_* columns.
--
-- NOTE: this is what the user ASKED for, never a balance. Credits always follow
-- the amount actually paid, against the rate locked at creation —
-- payment_amount / shannons_per_byte for AI3, and token_amount against
-- quoted_token_amount / quoted_bytes for USDC — so an over- or underpayment
-- grants a different number of bytes than this column records. Reporting that
-- reads quoted_bytes as storage sold will not reconcile with
-- purchased_credits.

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS quoted_bytes numeric(78,0);

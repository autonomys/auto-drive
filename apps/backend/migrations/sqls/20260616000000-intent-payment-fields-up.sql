-- Add payment-asset columns to intents for USDC-on-Ethereum support.
--
-- The payment asset is a first-class concept (see PaymentMethod in
-- @auto-drive/models) so new tokens/chains become configuration rather than
-- schema changes.
--
-- payment_method is NOT NULL with a default of 'ai3_native'. Every existing row
-- is a native-AI3 payment, so the default backfills them correctly and all
-- future rows carry an explicit method. (No CHECK constraint — the value set is
-- enforced in the application layer, matching the existing `status` column.)
--
-- The token_* / usd_rate columns apply only to token (USDC) payments and stay
-- NULL for native-AI3 intents:
--   token_amount         — raw on-chain amount received, token's smallest unit
--   quoted_token_amount  — amount quoted to the user at intent creation
--   usd_rate_at_creation — AI3/USD rate locked at creation, scaled by 1e18 (see
--                          USD_RATE_SCALE)
-- All three are numeric(78,0) to match the bigint base-unit convention already
-- used by payment_amount / shannons_per_byte.

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS payment_method       VARCHAR(32) NOT NULL DEFAULT 'ai3_native',
  ADD COLUMN IF NOT EXISTS token_amount         numeric(78,0),
  ADD COLUMN IF NOT EXISTS quoted_token_amount  numeric(78,0),
  ADD COLUMN IF NOT EXISTS usd_rate_at_creation numeric(78,0);

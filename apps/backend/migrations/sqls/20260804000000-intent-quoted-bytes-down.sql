-- Drop the recorded purchase size.
--
-- Safe to reverse while AI3 is the only payment method: quoted_bytes is written
-- at creation and read by nothing that derives credits, so removing it loses the
-- audit record of what a user asked for but changes no balance.
--
-- It stops being safe once USDC intents exist. There, quoted_bytes carries the
-- AI3 leg of the locked effective rate (quoted_token_amount buys
-- quoted_bytes * shannons_per_byte shannons), so dropping it leaves every
-- PENDING USDC intent with no rate to convert at — a payment landing afterwards
-- could not be turned into credits at all. Expire or settle outstanding USDC
-- intents before reversing.

ALTER TABLE intents
  DROP COLUMN IF EXISTS quoted_bytes;

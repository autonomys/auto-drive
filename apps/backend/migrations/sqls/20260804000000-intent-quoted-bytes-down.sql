-- Drop the recorded purchase size.
--
-- Safe to reverse while AI3 is the only payment method: quoted_bytes is written
-- at creation and read by nothing that derives credits, so removing it loses the
-- audit record of what a user asked for but changes no balance.
--
-- It stops being safe once USDC intents exist. There, quoted_bytes is the
-- denominator of the locked price per byte (quoted_token_amount / quoted_bytes),
-- so dropping it destroys the rate for every PENDING USDC intent — a payment
-- landing afterwards could not be converted to credits at all. Expire or settle
-- outstanding USDC intents before reversing.

ALTER TABLE intents
  DROP COLUMN IF EXISTS quoted_bytes;

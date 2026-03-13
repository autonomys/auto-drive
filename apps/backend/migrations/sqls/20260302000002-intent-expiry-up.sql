-- Add expires_at to intents for price-lock protection.
-- An intent is valid for a short window after creation (default 10 minutes).
-- If the transaction is not confirmed within that window the intent is treated
-- as expired and further operations on it are rejected.
--
-- Pre-feature rows have no expiry window, so we immediately expire any that
-- are still PENDING, then make the column NOT NULL so all future rows must
-- carry an explicit expiry.

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Expire pre-feature PENDING intents that have no tx_hash (nothing on-chain
-- to wait for) and stamp them with the epoch so the column can go NOT NULL.
UPDATE intents
  SET status    = 'expired',
      expires_at = '1970-01-01 00:00:00+00'
  WHERE expires_at IS NULL
    AND status   = 'pending'
    AND tx_hash  IS NULL;

-- Any remaining NULL rows were already confirmed/completed — backfill a
-- sentinel so we can enforce NOT NULL without losing data.
UPDATE intents
  SET expires_at = '1970-01-01 00:00:00+00'
  WHERE expires_at IS NULL;

ALTER TABLE intents
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intents_expires_at
  ON intents (status, expires_at)
  WHERE status = 'pending';

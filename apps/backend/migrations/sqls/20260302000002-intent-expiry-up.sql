-- Add expires_at to intents for price-lock protection.
-- An intent is valid for a short window after creation (default 10 minutes).
-- If the transaction is not confirmed within that window the intent is treated
-- as expired and further operations on it are rejected.
--
-- NULL is used for existing rows so the column is optional at the DB level;
-- application code always sets it on new intents.

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_intents_expires_at
  ON intents (status, expires_at)
  WHERE status = 'pending';

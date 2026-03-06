DROP INDEX IF EXISTS idx_intents_expires_at;

ALTER TABLE intents
  DROP COLUMN IF EXISTS expires_at;

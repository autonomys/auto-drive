DROP INDEX IF EXISTS idx_intents_expires_at;

ALTER TABLE intents
  DROP COLUMN IF EXISTS expires_at;

-- Note: rows that were expired by the up migration are not restored.
-- Rolling back re-opens no pending intents; the status changes are permanent.

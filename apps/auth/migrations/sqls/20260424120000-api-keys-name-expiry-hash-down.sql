-- Reverts the api-keys name/expiry/hash migration.
--
-- This is a safe schema-only revert. The original `secret` column was left
-- intact by the up migration, so every key that existed before the up runs
-- continues to authenticate after rollback.
--
-- Caveat: keys created between the up and down migrations were stored only
-- as a hash (no plaintext). Those rows will have `secret` = NULL after
-- rollback and will fail authentication with the old plaintext-comparison
-- code path. They are effectively revoked by the rollback. No pre-existing
-- key is affected.

DROP INDEX IF EXISTS users.idx_api_keys_owner;
DROP INDEX IF EXISTS users.idx_api_keys_secret_hash;

ALTER TABLE users.api_keys DROP COLUMN IF EXISTS secret_hash;
ALTER TABLE users.api_keys DROP COLUMN IF EXISTS prefix;
ALTER TABLE users.api_keys DROP COLUMN IF EXISTS expires_at;
ALTER TABLE users.api_keys DROP COLUMN IF EXISTS name;

-- We intentionally do NOT re-add NOT NULL on `secret`. Any rows created
-- while the migration was applied will have NULL there; re-adding the
-- constraint would make rollback fail until those rows are cleaned up.
-- Leaving it nullable makes rollback idempotent; operators can tighten
-- the schema manually afterwards if desired.

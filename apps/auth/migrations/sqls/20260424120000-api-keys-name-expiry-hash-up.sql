-- Adds user-facing metadata (name, expiry) and hash-at-rest auth for API keys.
--
-- This is an EXPAND-ONLY migration. We never mutate the original `secret`
-- column, so the corresponding down migration is a pure schema revert with
-- zero data loss for pre-existing keys.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users.api_keys ADD COLUMN name TEXT;
ALTER TABLE users.api_keys ADD COLUMN expires_at TIMESTAMP NULL;
ALTER TABLE users.api_keys ADD COLUMN prefix TEXT;
ALTER TABLE users.api_keys ADD COLUMN secret_hash TEXT;

-- Backfill the new columns from the existing plaintext `secret`. The original
-- column is left untouched, so rollback can restore the pre-migration state.
UPDATE users.api_keys
   SET secret_hash = encode(digest(secret, 'sha256'), 'hex'),
       prefix = LEFT(secret, 8),
       name = COALESCE(name, 'Legacy key')
 WHERE secret_hash IS NULL;

-- New keys created after this migration never populate `secret` (that's the
-- point of hashing at rest), so drop the NOT NULL constraint.
ALTER TABLE users.api_keys ALTER COLUMN secret DROP NOT NULL;

ALTER TABLE users.api_keys ALTER COLUMN name SET NOT NULL;
ALTER TABLE users.api_keys ALTER COLUMN prefix SET NOT NULL;
ALTER TABLE users.api_keys ALTER COLUMN secret_hash SET NOT NULL;

CREATE INDEX idx_api_keys_secret_hash ON users.api_keys (secret_hash);
CREATE INDEX idx_api_keys_owner
  ON users.api_keys (oauth_provider, oauth_user_id)
  WHERE deleted_at IS NULL;

-- A follow-up migration (not included here) can DROP COLUMN secret once we
-- are confident we'll never need to roll back, hardening the hash-at-rest
-- guarantee by removing the last plaintext copy from the database.

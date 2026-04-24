-- Adds user-facing metadata (name, expiry) and hashes secrets at rest.
-- Existing plaintext secrets are hashed in place so currently-issued keys
-- continue to work for their holders; we store a short prefix for UI display.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users.api_keys ADD COLUMN name TEXT;
ALTER TABLE users.api_keys ADD COLUMN expires_at TIMESTAMP NULL;
ALTER TABLE users.api_keys ADD COLUMN prefix TEXT;

-- Backfill prefix from current plaintext secret (first 8 chars, UI-only identifier).
UPDATE users.api_keys
   SET prefix = LEFT(secret, 8)
 WHERE prefix IS NULL;

-- Backfill a default name so the NOT NULL constraint succeeds.
UPDATE users.api_keys
   SET name = 'Legacy key'
 WHERE name IS NULL;

-- Hash existing plaintext secrets (sha256 hex). Authentication now hashes the
-- incoming secret and compares; existing keys keep working without rotation.
UPDATE users.api_keys
   SET secret = encode(digest(secret, 'sha256'), 'hex');

ALTER TABLE users.api_keys ALTER COLUMN name SET NOT NULL;
ALTER TABLE users.api_keys ALTER COLUMN prefix SET NOT NULL;

ALTER TABLE users.api_keys RENAME COLUMN secret TO secret_hash;

CREATE INDEX idx_api_keys_secret_hash ON users.api_keys (secret_hash);
CREATE INDEX idx_api_keys_owner
  ON users.api_keys (oauth_provider, oauth_user_id)
  WHERE deleted_at IS NULL;

-- Reverts name/expiry/hashing migration.
-- NOTE: Plaintext secrets cannot be recovered from hashes. Rolling back will
-- leave existing keys unusable; holders will need to rotate.

DROP INDEX IF EXISTS users.idx_api_keys_owner;
DROP INDEX IF EXISTS users.idx_api_keys_secret_hash;

ALTER TABLE users.api_keys RENAME COLUMN secret_hash TO secret;

ALTER TABLE users.api_keys DROP COLUMN IF EXISTS prefix;
ALTER TABLE users.api_keys DROP COLUMN IF EXISTS expires_at;
ALTER TABLE users.api_keys DROP COLUMN IF EXISTS name;

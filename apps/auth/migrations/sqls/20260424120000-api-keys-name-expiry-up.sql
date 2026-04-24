-- Adds user-facing metadata (name, expiry) to API keys.
--
-- Both columns are nullable: name is optional (users who don't supply one
-- end up with NULL, same as every pre-existing key), expires_at NULL means
-- "never". The `secret` column is untouched, so the down migration is a
-- trivial column-drop that can't orphan any existing key.

ALTER TABLE users.api_keys ADD COLUMN name TEXT NULL;
ALTER TABLE users.api_keys ADD COLUMN expires_at TIMESTAMP NULL;

CREATE INDEX idx_api_keys_owner
  ON users.api_keys (oauth_provider, oauth_user_id)
  WHERE deleted_at IS NULL;

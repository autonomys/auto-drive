-- Adds user-facing metadata (name, expiry) to API keys.
--
-- The `secret` column is left as-is (plaintext) — we intentionally did not
-- switch to hashing-at-rest here to keep this migration pure-additive and
-- trivially reversible. A future follow-up can add `secret_hash` alongside
-- `secret`, backfill it, and drop `secret` in a contract step once the
-- read path has migrated.

ALTER TABLE users.api_keys ADD COLUMN name TEXT;
ALTER TABLE users.api_keys ADD COLUMN expires_at TIMESTAMP NULL;

-- Existing rows predate the name column — give them a placeholder so the
-- UI has something to render. Users can rename via "drop + recreate" if
-- they care.
UPDATE users.api_keys SET name = 'Legacy key' WHERE name IS NULL;

ALTER TABLE users.api_keys ALTER COLUMN name SET NOT NULL;

CREATE INDEX idx_api_keys_owner
  ON users.api_keys (oauth_provider, oauth_user_id)
  WHERE deleted_at IS NULL;

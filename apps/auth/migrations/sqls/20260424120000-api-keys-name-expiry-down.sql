-- Reverts the api-keys name/expiry migration.
--
-- Pure-additive up => pure-drop down. No pre-existing keys are affected
-- because we never touched the `secret` column.

DROP INDEX IF EXISTS users.idx_api_keys_owner;

ALTER TABLE users.api_keys DROP COLUMN IF EXISTS expires_at;
ALTER TABLE users.api_keys DROP COLUMN IF EXISTS name;

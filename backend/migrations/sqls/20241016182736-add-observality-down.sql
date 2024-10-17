DROP TRIGGER IF EXISTS set_timestamp ON metadata;
DROP TRIGGER IF EXISTS set_timestamp ON nodes;
DROP TRIGGER IF EXISTS set_timestamp ON transaction_results;
DROP TRIGGER IF EXISTS set_timestamp ON users;
DROP TRIGGER IF EXISTS set_timestamp ON object_ownership;
DROP TRIGGER IF EXISTS set_timestamp ON api_keys;

ALTER TABLE metadata DROP COLUMN created_at;
ALTER TABLE metadata DROP COLUMN updated_at;

ALTER TABLE nodes DROP COLUMN created_at;
ALTER TABLE nodes DROP COLUMN updated_at;

ALTER TABLE transaction_results DROP COLUMN created_at;
ALTER TABLE transaction_results DROP COLUMN updated_at;

ALTER TABLE users DROP COLUMN created_at;
ALTER TABLE users DROP COLUMN updated_at;

ALTER TABLE object_ownership DROP COLUMN created_at;
ALTER TABLE object_ownership DROP COLUMN updated_at;

ALTER TABLE api_keys DROP COLUMN created_at;
ALTER TABLE api_keys DROP COLUMN updated_at;

DROP FUNCTION IF EXISTS trigger_set_timestamp();
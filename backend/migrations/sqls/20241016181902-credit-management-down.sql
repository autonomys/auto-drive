ALTER TABLE users DROP COLUMN "role";
ALTER TABLE users DROP COLUMN download_credits;
ALTER TABLE users DROP COLUMN upload_credits;

DROP TABLE IF EXISTS api_keys;
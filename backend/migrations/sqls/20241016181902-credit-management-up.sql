CREATE TABLE api_keys (
    api_key TEXT NOT NULL,
    user_id TEXT NOT NULL
);

ALTER TABLE users
ADD COLUMN "role" text NOT NULL DEFAULT 'User',
ADD COLUMN download_credits BIGINT NOT NULL DEFAULT 0,
ADD COLUMN upload_credits BIGINT NOT NULL DEFAULT 0;

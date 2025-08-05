CREATE SCHEMA IF NOT EXISTS "S3";

CREATE TABLE "S3".object_mappings (
    "key" text NOT NULL PRIMARY KEY,
    cid text NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_s3_mappings_cid ON "S3".object_mappings (cid);

CREATE TRIGGER set_timestamp
    BEFORE UPDATE
    ON "S3".object_mappings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

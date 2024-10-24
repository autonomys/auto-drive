/* Replace with your SQL commands */
CREATE SCHEMA uploads;

CREATE TABLE uploads.uploads (
    "id" TEXT PRIMARY KEY,
    "oauth_provider" TEXT NOT NULL,
    "oauth_user_id" TEXT NOT NULL,
    "root_upload_id" TEXT,
    "relative_id" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_tree" JSONB,
    "status" TEXT NOT NULL,
    "mime_type" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("oauth_provider", "oauth_user_id") REFERENCES users("oauth_provider", "oauth_user_id")
);

CREATE TABLE uploads.file_parts (
    "upload_id" TEXT NOT NULL,
    "part_index" INT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("upload_id") REFERENCES uploads.uploads("id") ON DELETE CASCADE,
    PRIMARY KEY ("upload_id", "part_index")
);

CREATE TABLE uploads.blockstore (
    "sort_id" SERIAL PRIMARY KEY,
    "upload_id" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "node_size" BIGINT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("upload_id") REFERENCES uploads.uploads("id") ON DELETE CASCADE
);

CREATE INDEX "blockstore_upload_id_cid_index" ON uploads.blockstore ("upload_id", "cid");

CREATE TABLE uploads.file_processing_info (
    "upload_id" TEXT PRIMARY KEY NOT NULL,
    "last_processed_part_index" INT,
    "last_processed_part_offset" INT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("upload_id") REFERENCES uploads.uploads("id") ON DELETE CASCADE
);


CREATE TRIGGER set_timestamp
AFTER UPDATE ON uploads.uploads
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp
AFTER UPDATE ON uploads.file_parts
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp
AFTER UPDATE ON uploads.blockstore
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp
AFTER UPDATE ON uploads.file_processing_info
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();


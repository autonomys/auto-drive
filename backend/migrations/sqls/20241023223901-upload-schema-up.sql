/* Replace with your SQL commands */
CREATE SCHEMA uploads;

CREATE TABLE uploads.uploads (
    "id" TEXT PRIMARY KEY,
    "oauth_provider" TEXT NOT NULL,
    "oauth_user_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "relative_id" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_tree" JSONB,
    "status" TEXT NOT NULL,
    "mime_type" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("parent_id") REFERENCES uploads.uploads("id"),
    FOREIGN KEY ("oauth_provider", "oauth_user_id") REFERENCES users("oauth_provider", "oauth_user_id")
);

CREATE TABLE uploads.file_parts (
    "id" TEXT PRIMARY KEY,
    "upload_id" TEXT NOT NULL,
    "part_number" INT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("upload_id") REFERENCES uploads.uploads("id")
);

CREATE TABLE uploads.blockstore (
    "upload_id" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "node_size" BIGINT NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("upload_id", "cid"),
    FOREIGN KEY ("upload_id") REFERENCES uploads.uploads("id")
);

CREATE TABLE uploads.file_processing_info (
    "upload_id" TEXT PRIMARY KEY NOT NULL,
    "last_processed_part_index" INT NOT NULL,
    "last_processed_part_offset" INT NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("upload_id") REFERENCES uploads.uploads("id")
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



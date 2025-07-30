CREATE SCHEMA IF NOT EXISTS s3;

CREATE TABLE s3.object_mappings (
    "key" text NOT NULL PRIMARY KEY,
    cid text NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT s3_object_mappings_cid_fkey FOREIGN KEY (cid) REFERENCES public.metadata(head_cid)
);

CREATE INDEX idx_s3_mappings_cid ON s3.object_mappings (cid);

CREATE TRIGGER set_timestamp
    BEFORE UPDATE
    ON s3.object_mappings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

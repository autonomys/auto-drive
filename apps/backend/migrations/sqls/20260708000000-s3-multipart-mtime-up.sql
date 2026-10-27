-- Staging for the client modification time of an in-progress multipart upload.
--
-- rclone sends x-amz-meta-mtime on CreateMultipartUpload, but NOT on
-- CompleteMultipartUpload — and the S3 object_mappings row is only created at
-- completion. This table stashes the mtime by upload id at create time so
-- completeMultipartUpload can persist it onto the mapping (matching the
-- single-PUT path). Rows are removed on Complete or Abort; a leftover row (an
-- upload that was neither completed nor aborted) is harmless and keyed by
-- upload_id so it is naturally superseded if the id is ever reused.

CREATE TABLE "S3".multipart_upload_meta (
    upload_id text PRIMARY KEY,
    mtime text NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

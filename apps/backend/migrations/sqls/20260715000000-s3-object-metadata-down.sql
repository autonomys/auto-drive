-- Reverse of the metadata migration. Restores the exact prior schema so an
-- up/down/up cycle (as the test suite runs) never errors.
--
-- Restoring mtime's NOT NULL requires first clearing any staging rows that hold
-- only metadata (mtime IS NULL) — they exist solely because the forward
-- migration allowed them. Staging rows are transient, so dropping them is safe.
ALTER TABLE "S3".object_mappings DROP COLUMN IF EXISTS metadata;
ALTER TABLE "S3".multipart_upload_meta DROP COLUMN IF EXISTS metadata;

DELETE FROM "S3".multipart_upload_meta WHERE mtime IS NULL;
ALTER TABLE "S3".multipart_upload_meta ALTER COLUMN mtime SET NOT NULL;

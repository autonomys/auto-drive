-- Persist standard S3 object metadata alongside the CID.
--
-- The S3 layer previously stored only Content-Type (as the IPLD node's mimeType)
-- and mtime, dropping Cache-Control, Content-Language, Content-Disposition,
-- Content-Encoding and arbitrary x-amz-meta-* headers. S3 clients expect object
-- metadata to round-trip verbatim on GET/HEAD and to be carried by CopyObject.
--
-- metadata: a JSONB bag of the per-key S3 metadata (contentType, cacheControl,
-- contentLanguage, contentDisposition, contentEncoding, and a userMetadata map
-- of x-amz-meta-* entries). It lives on the mapping — beside the content, not in
-- the content hash — because metadata is a property of the S3 key, not of the
-- bytes: two keys can point at the same CID with different declared metadata,
-- and content-addressed dedup stays intact. NULL for objects written before this
-- feature (they fall back to the IPLD-derived Content-Type as before).
ALTER TABLE "S3".object_mappings ADD COLUMN metadata jsonb;

-- Stage the metadata of an in-progress multipart upload the same way mtime is
-- staged: S3 sends system/user metadata on CreateMultipartUpload but not on
-- CompleteMultipartUpload, and the mapping row is only created at completion.
ALTER TABLE "S3".multipart_upload_meta ADD COLUMN metadata jsonb;

-- mtime is no longer the only thing a staging row can carry: an upload may stage
-- metadata with no client mtime. Relax the NOT NULL so such a row can exist.
ALTER TABLE "S3".multipart_upload_meta ALTER COLUMN mtime DROP NOT NULL;

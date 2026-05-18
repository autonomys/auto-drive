-- Add MD5 column to S3 object mappings.
--
-- BREAKING CHANGE: Prior to this migration the ETag returned by PutObject,
-- HeadObject, and CompleteMultipartUpload was the Autonomys CID of the object.
-- After this migration the ETag is an MD5 hash in standard AWS S3 format
-- (hex-encoded in double quotes, e.g. "d41d8cd98f00b204e9800998ecf8427e").
-- The CID is preserved and returned in the x-amz-meta-cid response header.
--
-- Existing rows have a NULL md5 (objects uploaded before this migration).
-- Those objects will continue to return a CID as their ETag until they are
-- re-uploaded.

ALTER TABLE "S3".object_mappings ADD COLUMN md5 text;

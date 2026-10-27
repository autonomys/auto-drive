-- Soft-delete + modification-time support for S3 object mappings.
--
-- deleted_at: when set, the (bucket, key) mapping is hidden from every S3 read
-- path (GET / HEAD / ListObjectsV2 / object-lock). The S3 DeleteObject operation
-- soft-deletes a key by setting this, without ever removing the underlying
-- content from the Autonomys DSN — permanence of the data is preserved; only the
-- S3 name is hidden. A later PutObject to the same key clears it (the
-- createMapping upsert resets deleted_at to NULL), matching S3's "PUT after
-- DELETE re-creates the object" semantics.
--
-- mtime: the modification-time metadata a client associates with the object
-- (rclone sends it as the x-amz-meta-mtime header, a float unix-seconds string).
-- Stored verbatim so it round-trips with full precision; NULL means the object
-- has no client mtime and Last-Modified (updated_at) is used instead.

ALTER TABLE "S3".object_mappings ADD COLUMN deleted_at timestamp;
ALTER TABLE "S3".object_mappings ADD COLUMN mtime text;

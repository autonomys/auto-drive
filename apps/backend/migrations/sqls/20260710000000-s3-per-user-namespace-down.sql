-- Revert to the global (bucket, key) primary key.
--
-- Best-effort: this FAILS if any (bucket, key) is owned by more than one user —
-- which is expected once the per-user namespace is in use (that's the whole
-- point of the forward migration). To roll back after adoption, an operator must
-- first resolve those collisions manually (e.g. keep one owner's row per
-- (bucket, key)); there is no unambiguous automatic choice.
ALTER TABLE "S3".object_mappings DROP CONSTRAINT object_mappings_pkey;

ALTER TABLE "S3".object_mappings
  ALTER COLUMN owner_oauth_provider DROP NOT NULL,
  ALTER COLUMN owner_oauth_user_id DROP NOT NULL;

ALTER TABLE "S3".object_mappings ADD PRIMARY KEY (bucket, "key");

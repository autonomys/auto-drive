-- Revert to the global (bucket, key) primary key.
--
-- The forward migration deliberately lets multiple owners hold the same
-- (bucket, key). Restoring a UNIQUE (bucket, key) primary key therefore has to
-- first collapse those back to a single row: we keep the most-recently-updated
-- row per (bucket, key) and drop the rest. This is LOSSY by nature — rolling
-- back after the per-user namespace has been used discards every non-winning
-- owner's row — but it is done automatically, and deterministically, so the
-- rollback always completes instead of erroring out on the very data the
-- forward migration was designed to allow. (It also keeps the test-suite's
-- per-suite down/up reset from breaking on cross-owner fixtures.)
ALTER TABLE "S3".object_mappings DROP CONSTRAINT IF EXISTS object_mappings_pkey;

-- Keep exactly one row per (bucket, key): the most recently updated, with ctid
-- as a stable tie-breaker. Everything else with a colliding (bucket, key) goes.
DELETE FROM "S3".object_mappings
WHERE ctid NOT IN (
  SELECT DISTINCT ON (bucket, "key") ctid
  FROM "S3".object_mappings
  ORDER BY bucket, "key", updated_at DESC, ctid DESC
);

ALTER TABLE "S3".object_mappings
  ALTER COLUMN owner_oauth_provider DROP NOT NULL,
  ALTER COLUMN owner_oauth_user_id DROP NOT NULL;

ALTER TABLE "S3".object_mappings ADD PRIMARY KEY (bucket, "key");

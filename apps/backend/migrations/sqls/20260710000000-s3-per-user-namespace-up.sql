-- Scope the S3 key namespace per user.
--
-- Change the mapping identity from the global (bucket, key) to
-- (owner, bucket, key). This removes cross-user contention over shared key names
-- entirely: two users can each own "default/test.txt", every read/write is
-- scoped to the caller, and the guard machinery that refereed the shared
-- namespace (cross-owner delete/copy gates, guarded upserts, pre-finalize
-- checks) becomes unnecessary.
--
-- Legacy rows: an earlier migration on this branch backfilled owner for every
-- CID with a single admin owner. The only NULL-owner rows left are ambiguous —
-- a CID with several admin owners (cross-user dedup on the same key). We
-- DUPLICATE those to every admin owner rather than guess one: guessing risks
-- 404ing the real user's key (their sync breaks with no self-service recovery),
-- whereas a surprise duplicate is a key the user can simply soft-delete. Gaining
-- clutter beats losing access. (Expected NULL-owner count in production: zero —
-- worth confirming with a COUNT(*) pre-flight.)

-- Fail loud on rows we cannot attribute: a NULL-owner mapping whose CID has NO
-- admin owner has no one to duplicate to, so the DELETE below would silently
-- drop the key. Abort and let an operator resolve it instead of losing data.
DO $$
DECLARE
  orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM "S3".object_mappings om
  WHERE om.owner_oauth_user_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM object_ownership oo
      WHERE oo.cid = om.cid AND oo.is_admin = true
    );
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot scope S3 namespace per user: % NULL-owner mapping(s) have no admin '
      'owner to attribute them to. Resolve these rows manually before migrating.',
      orphan_count;
  END IF;
END $$;

-- Drop the (bucket, key) uniqueness FIRST, so duplicating a NULL-owner row to
-- multiple admin owners (same bucket/key, different owner) does not violate it.
-- IF EXISTS keeps re-application idempotent (the down migration re-adds this PK,
-- so an up/down/up cycle must not trip over an already-dropped constraint).
ALTER TABLE "S3".object_mappings DROP CONSTRAINT IF EXISTS object_mappings_pkey;

-- Duplicate each remaining NULL-owner mapping to every admin owner of its CID.
INSERT INTO "S3".object_mappings
  (bucket, "key", cid, md5, mtime, deleted_at, created_at, updated_at,
   owner_oauth_provider, owner_oauth_user_id)
SELECT om.bucket, om."key", om.cid, om.md5, om.mtime, om.deleted_at,
       om.created_at, om.updated_at, oo.oauth_provider, oo.oauth_user_id
FROM "S3".object_mappings om
JOIN object_ownership oo ON oo.cid = om.cid AND oo.is_admin = true
WHERE om.owner_oauth_user_id IS NULL;

-- Remove the now-superseded NULL-owner originals.
DELETE FROM "S3".object_mappings WHERE owner_oauth_user_id IS NULL;

-- Owner is now part of the identity.
ALTER TABLE "S3".object_mappings
  ALTER COLUMN owner_oauth_provider SET NOT NULL,
  ALTER COLUMN owner_oauth_user_id SET NOT NULL;

-- The new per-user primary key.
ALTER TABLE "S3".object_mappings
  ADD PRIMARY KEY (owner_oauth_provider, owner_oauth_user_id, bucket, "key");

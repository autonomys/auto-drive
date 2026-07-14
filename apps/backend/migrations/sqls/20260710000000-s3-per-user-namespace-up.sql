-- Scope the S3 key namespace per user.
--
-- Change the mapping identity from the global (bucket, key) to
-- (owner, bucket, key). This removes cross-user contention over shared key names
-- entirely: two users can each own "default/test.txt", every read/write is
-- scoped to the caller, and the guard machinery that refereed the shared
-- namespace (cross-owner delete/copy gates, guarded upserts, pre-finalize
-- checks) becomes unnecessary.
--
-- Attribution of existing rows: the S3 layer has been live, so there may be
-- pre-existing mappings — and they have no owner column yet. Auto Drive is
-- content addressed, so a mapping's creator is an admin owner of its CID
-- (setUserAsAdmin on the dataCid at upload). We attribute every owner-less
-- mapping to the admin owner(s) of its CID. A CID with several admin owners
-- (cross-user dedup on the same key) is DUPLICATED to each rather than guessing
-- one: guessing risks 404ing the real user's key (their sync breaks with no
-- self-service recovery), whereas a surprise duplicate is a key the user can
-- simply soft-delete. Gaining clutter beats losing access.

-- Owner columns. Nullable only for the span of this migration: they are
-- populated by the attribution below and made NOT NULL before it ends.
ALTER TABLE "S3".object_mappings ADD COLUMN owner_oauth_provider text;
ALTER TABLE "S3".object_mappings ADD COLUMN owner_oauth_user_id text;

-- Fail loud on rows we cannot attribute: a mapping whose CID has NO admin owner
-- has no one to attribute it to, so the DELETE below would silently drop the
-- key. Abort and let an operator resolve it instead of losing data. (Expected
-- count in production: zero — worth confirming with this same COUNT(*) as a
-- pre-flight before deploying.)
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
      'Cannot scope S3 namespace per user: % mapping(s) have no admin owner to '
      'attribute them to. Resolve these rows manually before migrating.',
      orphan_count;
  END IF;
END $$;

-- Drop the (bucket, key) uniqueness FIRST, so attributing one mapping to
-- multiple admin owners (same bucket/key, different owner) does not violate it.
-- IF EXISTS keeps re-application idempotent (the down migration re-adds this PK,
-- so an up/down/up cycle must not trip over an already-dropped constraint).
ALTER TABLE "S3".object_mappings DROP CONSTRAINT IF EXISTS object_mappings_pkey;

-- Attribute every owner-less mapping to the admin owner(s) of its CID: one new
-- row per owner. The SELECT sees only the pre-existing (owner-less) rows — the
-- rows this INSERT creates are invisible to it within the same statement — so
-- each original is expanded exactly once.
INSERT INTO "S3".object_mappings
  (bucket, "key", cid, md5, mtime, deleted_at, created_at, updated_at,
   owner_oauth_provider, owner_oauth_user_id)
SELECT om.bucket, om."key", om.cid, om.md5, om.mtime, om.deleted_at,
       om.created_at, om.updated_at, oo.oauth_provider, oo.oauth_user_id
FROM "S3".object_mappings om
JOIN object_ownership oo ON oo.cid = om.cid AND oo.is_admin = true
WHERE om.owner_oauth_user_id IS NULL;

-- Remove the now-superseded owner-less originals.
DELETE FROM "S3".object_mappings WHERE owner_oauth_user_id IS NULL;

-- Owner is now part of the identity.
ALTER TABLE "S3".object_mappings
  ALTER COLUMN owner_oauth_provider SET NOT NULL,
  ALTER COLUMN owner_oauth_user_id SET NOT NULL;

-- The new per-user primary key.
ALTER TABLE "S3".object_mappings
  ADD PRIMARY KEY (owner_oauth_provider, owner_oauth_user_id, bucket, "key");

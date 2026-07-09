-- Record which user created each S3 key mapping.
--
-- DeleteObject (and its Trash-propagation count / restore) must be scoped to the
-- key's OWNER, not to any admin owner of its CID. Auto Drive is content
-- addressed, so two users who upload byte-identical content both become admin
-- owners of the same CID (setUserAsAdmin on the shared dataCid). A per-CID gate
-- therefore lets a dedup co-owner hide another user's key; a per-mapping owner
-- closes that.

ALTER TABLE "S3".object_mappings ADD COLUMN owner_oauth_provider text;
ALTER TABLE "S3".object_mappings ADD COLUMN owner_oauth_user_id text;

-- Backfill only where unambiguous: a CID with exactly one admin owner has a
-- single possible creator, so that owner is the mapping's owner. CIDs with zero
-- or several admin owners (e.g. cross-user dedup) are left NULL and fall back to
-- the per-CID admin check at delete time — no row is ever mis-assigned.
UPDATE "S3".object_mappings om
SET owner_oauth_provider = sole.oauth_provider,
    owner_oauth_user_id = sole.oauth_user_id
FROM (
  SELECT cid,
         MIN(oauth_provider) AS oauth_provider,
         MIN(oauth_user_id) AS oauth_user_id
  FROM object_ownership
  WHERE is_admin = true
  GROUP BY cid
  HAVING COUNT(*) = 1
) sole
WHERE om.cid = sole.cid;

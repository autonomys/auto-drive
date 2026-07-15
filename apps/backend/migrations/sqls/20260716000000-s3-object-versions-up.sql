-- Append-only version history for S3 objects (versioned-WORM, issue #781).
--
-- object_mappings stays exactly as it is: the CURRENT-version pointer per
-- (owner, bucket, key), with deleted_at driving soft-delete and the web-app
-- Trash sync (untouched). This table records every content write as an
-- immutable version row, so we can answer ListObjectVersions and GET ?versionId
-- without changing the current read/delete/restore paths.
--
-- versionId = the CID. Delete markers are NOT stored here: the "current key is
-- deleted" state already lives on object_mappings.deleted_at, so a delete marker
-- is synthesised from it at read time. That keeps the delete/restore/Trash-sync
-- logic (deleted_at + restoreMappingsByCid) the single source of truth for
-- visibility, and this table a pure, append-only log of content.
CREATE TABLE "S3".object_versions (
    id bigserial PRIMARY KEY,
    owner_oauth_provider text NOT NULL,
    owner_oauth_user_id text NOT NULL,
    bucket text NOT NULL,
    "key" text NOT NULL,
    -- The content CID for this version. Always set: markers are derived, not stored.
    cid text NOT NULL,
    md5 text,
    mtime text,
    metadata jsonb,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Newest-first enumeration of a key's versions (ListObjectVersions ordering).
CREATE INDEX object_versions_key_idx
    ON "S3".object_versions (owner_oauth_provider, owner_oauth_user_id, bucket, "key", id DESC);

-- Point lookup of a specific version by CID (GET/HEAD ?versionId=<cid>).
CREATE INDEX object_versions_cid_idx
    ON "S3".object_versions (owner_oauth_provider, owner_oauth_user_id, bucket, "key", cid);

-- Backfill one version per existing mapping so pre-existing objects have a
-- history (their single current content version). Soft-deleted mappings are
-- included: the content version still exists; the delete marker for them is
-- synthesised from deleted_at at read time. updated_at is when the current
-- content was written, so it is the version's creation time.
INSERT INTO "S3".object_versions
  (owner_oauth_provider, owner_oauth_user_id, bucket, "key", cid, md5, mtime, metadata, created_at)
SELECT owner_oauth_provider, owner_oauth_user_id, bucket, "key", cid, md5, mtime, metadata, updated_at
FROM "S3".object_mappings;

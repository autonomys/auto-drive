-- Add bucket support to S3 object mappings.
--
-- Existing keys are split at the first '/':
--   my-archive/file.txt  → bucket='my-archive', key='file.txt'
--   test.txt             → bucket='default',    key='test.txt'
--
-- Keys with no '/' (flat uploads) land in the 'default' bucket and
-- remain accessible at the same path as before.
--
-- The primary key changes from (key) to (bucket, key).

ALTER TABLE "S3".object_mappings ADD COLUMN bucket text;

-- Split keys that contain a '/'. The bucket becomes the first segment
-- and the key becomes everything after it.
UPDATE "S3".object_mappings
  SET bucket = split_part(key, '/', 1),
      key    = substring(key from position('/' in key) + 1)
  WHERE key LIKE '%/%';

-- Flat keys (no '/') go to the default bucket unchanged.
UPDATE "S3".object_mappings
  SET bucket = 'default'
  WHERE bucket IS NULL OR bucket = '';

ALTER TABLE "S3".object_mappings ALTER COLUMN bucket SET NOT NULL;
ALTER TABLE "S3".object_mappings ALTER COLUMN bucket SET DEFAULT 'default';

-- Replace the single-column primary key with a composite one.
ALTER TABLE "S3".object_mappings DROP CONSTRAINT IF EXISTS object_mappings_pkey;
ALTER TABLE "S3".object_mappings ADD PRIMARY KEY (bucket, key);

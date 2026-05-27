-- Reverse the bucket migration by re-joining bucket + key.
-- Objects in 'default' with no original prefix are restored as flat keys.

ALTER TABLE "S3".object_mappings DROP CONSTRAINT IF EXISTS object_mappings_pkey;

-- Non-default buckets: prepend bucket name back onto the key.
UPDATE "S3".object_mappings
  SET key = bucket || '/' || key
  WHERE bucket != 'default';

-- Default bucket: key is already the correct flat value; no change needed.

ALTER TABLE "S3".object_mappings DROP COLUMN bucket;

ALTER TABLE "S3".object_mappings ADD PRIMARY KEY (key);

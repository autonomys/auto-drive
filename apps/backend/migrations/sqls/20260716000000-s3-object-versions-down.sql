-- Drop the version history. object_mappings is untouched by the forward
-- migration, so removing this table fully reverts the change.
DROP TABLE IF EXISTS "S3".object_versions;

-- Drop triggers first
DROP TRIGGER IF EXISTS "update_metadata_updated_at" ON "metadata";
DROP TRIGGER IF EXISTS "update_object_ownership_updated_at" ON "object_ownership";
DROP TRIGGER IF EXISTS "update_nodes_updated_at" ON "nodes";
DROP TRIGGER IF EXISTS "update_subscriptions_updated_at" ON "subscriptions";
DROP TRIGGER IF EXISTS "update_interactions_updated_at" ON "interactions";
DROP TRIGGER IF EXISTS "update_uploads_uploads_updated_at" ON "uploads.uploads";
DROP TRIGGER IF EXISTS "update_uploads_blockstore_updated_at" ON "uploads.blockstore";
DROP TRIGGER IF EXISTS "update_uploads_file_parts_updated_at" ON "uploads.file_parts";
DROP TRIGGER IF EXISTS "update_uploads_file_processing_info_updated_at" ON "uploads.file_processing_info";

-- Drop foreign keys
ALTER TABLE IF EXISTS "object_ownership" DROP CONSTRAINT IF EXISTS "object_ownership_cid_fkey";
ALTER TABLE IF EXISTS "nodes" DROP CONSTRAINT IF EXISTS "nodes_head_cid_fkey";
ALTER TABLE IF EXISTS "interactions" DROP CONSTRAINT IF EXISTS "interactions_subscription_id_fkey";
ALTER TABLE IF EXISTS "uploads.blockstore" DROP CONSTRAINT IF EXISTS "uploads.blockstore_upload_id_fkey";
ALTER TABLE IF EXISTS "uploads.file_parts" DROP CONSTRAINT IF EXISTS "uploads.file_parts_upload_id_fkey";
ALTER TABLE IF EXISTS "uploads.file_processing_info" DROP CONSTRAINT IF EXISTS "uploads.file_processing_info_upload_id_fkey";

-- Drop tables
DROP TABLE IF EXISTS "uploads.blockstore";
DROP TABLE IF EXISTS "uploads.uploads";
DROP TABLE IF EXISTS "uploads.file_parts";
DROP TABLE IF EXISTS "uploads.file_processing_info";
DROP TABLE IF EXISTS "interactions";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "nodes";
DROP TABLE IF EXISTS "object_ownership";
DROP TABLE IF EXISTS "metadata";
DROP TABLE IF EXISTS "published_objects";

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop schemas (not public)
DROP SCHEMA IF EXISTS "uploads" CASCADE;


-- Drop all triggers
DROP TRIGGER IF EXISTS update_uploads_uploads_updated_at ON "uploads.uploads";
DROP TRIGGER IF EXISTS update_uploads_file_parts_updated_at ON "uploads.file_parts";
DROP TRIGGER IF EXISTS update_uploads_file_processing_info_updated_at ON "uploads.file_processing_info";
DROP TRIGGER IF EXISTS update_uploads_blockstore_updated_at ON "uploads.blockstore";
DROP TRIGGER IF EXISTS update_metadata_updated_at ON "metadata";
DROP TRIGGER IF EXISTS update_object_ownership_updated_at ON "object_ownership";
DROP TRIGGER IF EXISTS update_nodes_updated_at ON "nodes";
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON "subscriptions";
DROP TRIGGER IF EXISTS update_interactions_updated_at ON "interactions";
DROP TRIGGER IF EXISTS update_published_objects_updated_at ON "published_objects";

-- Drop the function
DROP FUNCTION IF EXISTS update_updated_at_column();
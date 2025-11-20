-- Remove indexes added in up migration
DROP INDEX IF EXISTS idx_nodes_cid;
DROP INDEX IF EXISTS idx_nodes_root_cid_cid;


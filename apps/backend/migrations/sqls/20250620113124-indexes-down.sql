-- interactions
DROP INDEX IF EXISTS idx_interactions_subscription_id;

-- nodes
DROP INDEX IF EXISTS idx_nodes_root_cid;
DROP INDEX IF EXISTS idx_nodes_head_cid;
DROP INDEX IF EXISTS idx_nodes_head_block_inc_tx;
DROP INDEX IF EXISTS idx_nodes_published_by_head;
DROP INDEX IF EXISTS idx_nodes_archived_by_head;


-- metadata
DROP INDEX IF EXISTS idx_metadata_head_cid;

-- object_ownership
DROP INDEX IF EXISTS idx_object_ownership_admin_partial;
DROP INDEX IF EXISTS idx_object_admin_cid;

-- metadata
DROP INDEX IF EXISTS idx_metadata_roots_partial;
DROP INDEX IF EXISTS idx_metadata_created_at;
DROP INDEX IF EXISTS idx_root_metadata_created_at;
DROP INDEX IF EXISTS idx_metadata_root_cid;
DROP INDEX IF EXISTS idx_metadata_created_desc;
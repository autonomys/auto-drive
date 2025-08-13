-- metadata
CREATE INDEX idx_metadata_head_cid ON public.metadata (head_cid);

-- nodes
CREATE INDEX idx_nodes_head_cid ON public.nodes (head_cid);
CREATE INDEX idx_nodes_root_cid ON public.nodes (root_cid);

-- interactions
CREATE INDEX idx_interactions_subscription_id ON public.interactions (subscription_id);

-- =========================
-- OBJECT_OWNERSHIP
-- =========================

-- Partial index for fast admin-exists checks (used in your EXISTS filters)
CREATE INDEX IF NOT EXISTS idx_object_ownership_admin_partial
ON public.object_ownership USING btree (cid)
WHERE (is_admin IS TRUE);

-- Covers lookups by cid and admin flag; also serves pure cid lookups due to leading column
CREATE INDEX IF NOT EXISTS idx_object_admin_cid
ON public.object_ownership USING btree (cid, is_admin);

-- Note: Skipped idx_object_cid because idx_object_admin_cid (leading cid) already covers cid-only lookups.

-- =========================
-- NODES
-- =========================

-- Counts by head, published/archived filters, and "top row by block_published_on"
-- This INCLUDE allows fetching tx_published_on without heap lookups.
CREATE INDEX IF NOT EXISTS idx_nodes_head_block_inc_tx
ON public.nodes USING btree (head_cid, block_published_on)
INCLUDE (tx_published_on);

-- Fast counts where published (block_published_on IS NOT NULL)
CREATE INDEX IF NOT EXISTS idx_nodes_published_by_head
ON public.nodes USING btree (head_cid)
WHERE (block_published_on IS NOT NULL);

-- Fast counts where archived (piece_offset IS NOT NULL)
CREATE INDEX IF NOT EXISTS idx_nodes_archived_by_head
ON public.nodes USING btree (head_cid)
WHERE (piece_offset IS NOT NULL);

-- =========================
-- METADATA
-- =========================

-- “Roots only” fast path (head_cid = root_cid)
CREATE INDEX IF NOT EXISTS idx_metadata_roots_partial
ON public.metadata USING btree (head_cid)
WHERE (head_cid = root_cid);

-- Plain created_at for generic time filters
CREATE INDEX IF NOT EXISTS idx_metadata_created_at
ON public.metadata USING btree (created_at);

-- Created_at restricted to roots (root_cid = head_cid) for Top-N roots
CREATE INDEX IF NOT EXISTS idx_root_metadata_created_at
ON public.metadata USING btree (created_at)
WHERE (root_cid = head_cid);

-- Direct access by root_cid (helps joining metadata_roots -> metadata)
CREATE INDEX IF NOT EXISTS idx_metadata_root_cid
ON public.metadata USING btree (root_cid);

-- Ordered index for DESC queries (e.g., Top-N by created_at) with join keys handy
CREATE INDEX IF NOT EXISTS idx_metadata_created_desc
ON public.metadata USING btree (created_at DESC, root_cid, head_cid)
INCLUDE (head_cid);

-- Add indexes for nodes table to improve query performance
-- These indexes optimize queries that filter by cid and (root_cid, cid)

-- Index for cid lookups (used in getNodesByCids, getNodeCount, getNodeBlockchainData)
CREATE INDEX IF NOT EXISTS idx_nodes_cid ON public.nodes USING btree (cid);

-- Composite index for UPDATE queries that filter by root_cid AND cid
-- Used in updateNodeBlockchainData
CREATE INDEX IF NOT EXISTS idx_nodes_root_cid_cid ON public.nodes USING btree (root_cid, cid);


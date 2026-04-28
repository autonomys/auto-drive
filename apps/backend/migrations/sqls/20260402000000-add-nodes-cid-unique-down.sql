-- Revert: replace unique index with the non-unique index that existed before.
-- This restores the state from migration 20251118 (add-nodes-cid-indexes).
DROP INDEX IF EXISTS idx_nodes_cid;
CREATE INDEX IF NOT EXISTS idx_nodes_cid ON public.nodes USING btree (cid);

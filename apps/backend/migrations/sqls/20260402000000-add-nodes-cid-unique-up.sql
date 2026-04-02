-- Migration: restore uniqueness on nodes.cid
--
-- Background:
--   20241002 init-schema created nodes with PRIMARY KEY (cid).
--   20250924 dropped nodes_pkey without replacement.
--   20251118 added idx_nodes_cid as a non-unique btree index.
--
-- The ON CONFLICT (cid) upsert clauses in saveNode/saveNodes require a
-- unique index.  This migration:
--   1. Removes any duplicate CID rows that may have accumulated (keeps
--      the most useful row — the one with archival data, breaking ties
--      by created_at).
--   2. Replaces the non-unique idx_nodes_cid with a UNIQUE index.
--
-- Safety:
--   • The dedup DELETE is a no-op when no duplicates exist.
--   • IF EXISTS / IF NOT EXISTS guards make each statement idempotent.

-- Step 1: deduplicate — keep one row per CID
-- Priority: prefer row that already has archival data (piece_index IS NOT NULL),
-- then most recently created row, then highest ctid as final tiebreaker.
WITH ranked AS (
  SELECT ctid AS tid,
         ROW_NUMBER() OVER (
           PARTITION BY cid
           ORDER BY (CASE WHEN piece_index IS NOT NULL THEN 0 ELSE 1 END),
                    created_at DESC NULLS LAST,
                    ctid DESC
         ) AS rn
  FROM nodes
)
DELETE FROM nodes
WHERE ctid IN (SELECT tid FROM ranked WHERE rn > 1);

-- Step 2: drop the old non-unique index
DROP INDEX IF EXISTS idx_nodes_cid;

-- Step 3: create the unique index
CREATE UNIQUE INDEX idx_nodes_cid ON public.nodes USING btree (cid);

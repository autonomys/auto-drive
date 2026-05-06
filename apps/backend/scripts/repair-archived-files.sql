-- =============================================================================
-- REPAIR SCRIPT: Fix Archived Files Data Integrity
-- =============================================================================
-- Run the audit script FIRST to understand the state of your data.
-- Then use the appropriate repair step below based on the category.
--
-- IMPORTANT: Take a DB backup before running any UPDATE/INSERT statements.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- REPAIR STEP 1: Un-archive files that still have full data in DB
--
-- Category B files (FULL_DATA_IN_DB): These were marked archived but their
-- encoded_node data was never stripped (the 21GB vs 6GB situation).
-- By un-archiving them, the new safe onObjectArchived code will re-process
-- them correctly: populate cache FIRST, then strip data.
--
-- After un-archiving, the checkObjectsArchivalStatus background job will
-- re-detect them and process them through the new safe archival path.
-- ─────────────────────────────────────────────────────────────────────────────

-- DRY RUN: See which files would be un-archived
WITH candidates AS (
  SELECT
    m.head_cid,
    m.name,
    (m.metadata->>'totalSize')::bigint AS total_size,
    jsonb_array_length(COALESCE(m.metadata->'chunks', '[]'::jsonb)) AS expected_chunks
  FROM metadata m
  WHERE m.head_cid = m.root_cid
    AND m.is_archived = true
    AND m.metadata->>'type' = 'file'
),
node_stats AS (
  SELECT
    root_cid,
    COUNT(*) AS total_nodes,
    COUNT(*) FILTER (WHERE encoded_node IS NOT NULL) AS nodes_with_data
  FROM nodes
  GROUP BY root_cid
)
SELECT
  c.head_cid,
  c.name,
  pg_size_pretty(c.total_size) AS size,
  c.expected_chunks,
  ns.total_nodes,
  ns.nodes_with_data
FROM candidates c
JOIN node_stats ns ON ns.root_cid = c.head_cid
WHERE ns.nodes_with_data = ns.total_nodes
  AND ns.total_nodes >= c.expected_chunks;

-- ACTUAL REPAIR: Un-archive category B files
-- Uncomment to execute:
/*
WITH candidates AS (
  SELECT m.head_cid
  FROM metadata m
  WHERE m.head_cid = m.root_cid
    AND m.is_archived = true
    AND m.metadata->>'type' = 'file'
),
full_data_files AS (
  SELECT c.head_cid
  FROM candidates c
  JOIN (
    SELECT
      root_cid,
      COUNT(*) AS total_nodes,
      COUNT(*) FILTER (WHERE encoded_node IS NOT NULL) AS nodes_with_data
    FROM nodes
    GROUP BY root_cid
  ) ns ON ns.root_cid = c.head_cid
  WHERE ns.nodes_with_data = ns.total_nodes
    AND ns.total_nodes > 0
)
UPDATE metadata
SET is_archived = false
WHERE head_cid IN (SELECT head_cid FROM full_data_files)
  AND root_cid = head_cid;
*/


-- ─────────────────────────────────────────────────────────────────────────────
-- REPAIR STEP 2: Re-publish nodes missing piece_index/piece_offset
--
-- Category C/E files have some nodes that were never published on-chain
-- (piece_index IS NULL). These need to be re-queued for on-chain publishing
-- so the DSN has their data.
--
-- This finds nodes that still have encoded_node data but no piece_index,
-- meaning they were never successfully published to the DSN.
-- ─────────────────────────────────────────────────────────────────────────────

-- DRY RUN: Find unpublished nodes that still have data
SELECT
  n.root_cid,
  m.name,
  COUNT(*) AS unpublished_nodes,
  pg_size_pretty(SUM(LENGTH(n.encoded_node))::bigint) AS data_size
FROM nodes n
JOIN metadata m ON m.head_cid = n.root_cid AND m.root_cid = m.head_cid
WHERE n.encoded_node IS NOT NULL
  AND n.piece_index IS NULL
GROUP BY n.root_cid, m.name
ORDER BY COUNT(*) DESC;

-- To re-publish these, the application needs to re-queue them via the
-- task manager. This can be done by un-archiving the parent file (Step 1)
-- and letting the normal publish pipeline re-process them.


-- ─────────────────────────────────────────────────────────────────────────────
-- REPAIR STEP 3: Identify permanently lost files
--
-- Category A files (ALL_NODES_MISSING): No nodes exist in the DB at all.
-- These can only be recovered if the object-mapping-indexer has their hashes.
--
-- This generates a list of CIDs that need to be checked against the
-- Files Gateway's object-mapping-indexer.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  m.head_cid,
  m.name,
  pg_size_pretty((m.metadata->>'totalSize')::bigint) AS size,
  m.metadata->>'type' AS type,
  m.created_at,
  jsonb_array_length(COALESCE(m.metadata->'chunks', '[]'::jsonb)) AS expected_chunks,
  COALESCE(n.actual_nodes, 0) AS actual_nodes
FROM metadata m
LEFT JOIN (
  SELECT root_cid, COUNT(*) AS actual_nodes
  FROM nodes
  GROUP BY root_cid
) n ON n.root_cid = m.head_cid
WHERE m.head_cid = m.root_cid
  AND m.is_archived = true
  AND COALESCE(n.actual_nodes, 0) = 0
ORDER BY m.created_at;


-- ─────────────────────────────────────────────────────────────────────────────
-- REPAIR STEP 4: Clean up stuck async downloads
--
-- Mark long-stuck async downloads as failed so they don't block the queue.
-- ─────────────────────────────────────────────────────────────────────────────

-- DRY RUN: See stuck downloads
SELECT
  id,
  cid,
  status,
  downloaded_bytes,
  file_size,
  created_at,
  updated_at,
  NOW() - updated_at AS stuck_for
FROM async_downloads
WHERE status = 'pending'
  AND updated_at < NOW() - INTERVAL '1 hour';

-- ACTUAL REPAIR: Mark stuck downloads as failed
-- Uncomment to execute:
/*
UPDATE async_downloads
SET status = 'failed',
    error = 'Marked as failed by repair script — download was stuck for over 1 hour'
WHERE status = 'pending'
  AND updated_at < NOW() - INTERVAL '1 hour';
*/

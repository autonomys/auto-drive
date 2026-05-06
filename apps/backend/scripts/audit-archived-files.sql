-- =============================================================================
-- AUDIT SCRIPT: Archived Files Data Integrity
-- =============================================================================
-- Run these queries against the production auto-drive DB to diagnose
-- data integrity issues with archived files.
-- All queries are read-only (SELECT only).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. OVERVIEW: Archived files summary
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'Total root objects' AS metric,
  COUNT(*)::text AS value
FROM metadata
WHERE head_cid = root_cid

UNION ALL

SELECT
  'Archived root objects',
  COUNT(*)::text
FROM metadata
WHERE head_cid = root_cid AND is_archived = true

UNION ALL

SELECT
  'Non-archived root objects',
  COUNT(*)::text
FROM metadata
WHERE head_cid = root_cid AND is_archived = false

UNION ALL

SELECT
  'Total nodes',
  COUNT(*)::text
FROM nodes

UNION ALL

SELECT
  'Nodes with encoded_node data',
  COUNT(*)::text
FROM nodes
WHERE encoded_node IS NOT NULL

UNION ALL

SELECT
  'Nodes with encoded_node stripped (NULL)',
  COUNT(*)::text
FROM nodes
WHERE encoded_node IS NULL

UNION ALL

SELECT
  'DB size of encoded_node data (approx MB)',
  (SUM(LENGTH(encoded_node)) / 1048576)::text
FROM nodes
WHERE encoded_node IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FIND FILES WITH MISSING CHUNK NODES
--    Compares the expected chunk count from metadata JSON against actual
--    node rows in the DB.
-- ─────────────────────────────────────────────────────────────────────────────
WITH root_metadata AS (
  SELECT
    m.head_cid,
    m.is_archived,
    m.name,
    m.metadata->>'type' AS obj_type,
    (m.metadata->>'totalSize')::bigint AS total_size,
    jsonb_array_length(COALESCE(m.metadata->'chunks', '[]'::jsonb)) AS expected_chunks
  FROM metadata m
  WHERE m.head_cid = m.root_cid
    AND m.metadata->>'type' = 'file'
),
actual_nodes AS (
  SELECT
    root_cid,
    COUNT(*) AS actual_node_count,
    COUNT(*) FILTER (WHERE encoded_node IS NOT NULL) AS nodes_with_data,
    COUNT(*) FILTER (WHERE piece_index IS NOT NULL) AS nodes_with_piece_mapping,
    COUNT(*) FILTER (WHERE encoded_node IS NULL AND piece_index IS NULL) AS orphan_nodes
  FROM nodes
  GROUP BY root_cid
)
SELECT
  rm.head_cid,
  rm.name,
  rm.is_archived,
  rm.total_size,
  rm.expected_chunks,
  COALESCE(an.actual_node_count, 0) AS actual_nodes,
  COALESCE(an.nodes_with_data, 0) AS nodes_with_data,
  COALESCE(an.nodes_with_piece_mapping, 0) AS nodes_with_mapping,
  COALESCE(an.orphan_nodes, 0) AS orphan_nodes,
  CASE
    WHEN COALESCE(an.actual_node_count, 0) = 0 THEN 'ALL_NODES_MISSING'
    WHEN COALESCE(an.actual_node_count, 0) < rm.expected_chunks THEN 'SOME_NODES_MISSING'
    WHEN an.nodes_with_data = an.actual_node_count THEN 'FULL_DATA_IN_DB'
    WHEN an.nodes_with_piece_mapping = an.actual_node_count THEN 'CORRECTLY_ARCHIVED'
    WHEN an.nodes_with_data > 0 AND an.nodes_with_data < an.actual_node_count THEN 'PARTIALLY_STRIPPED'
    ELSE 'UNKNOWN'
  END AS status
FROM root_metadata rm
LEFT JOIN actual_nodes an ON an.root_cid = rm.head_cid
WHERE rm.is_archived = true
  AND (
    COALESCE(an.actual_node_count, 0) < rm.expected_chunks
    OR COALESCE(an.nodes_with_data, 0) < COALESCE(an.actual_node_count, 0)
  )
ORDER BY
  CASE
    WHEN COALESCE(an.actual_node_count, 0) = 0 THEN 0
    WHEN COALESCE(an.actual_node_count, 0) < rm.expected_chunks THEN 1
    ELSE 2
  END,
  rm.total_size DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FIND ARCHIVED FILES THAT STILL HAVE ALL encoded_node DATA
--    These are the "21GB but 6GB uploaded" files — data was never stripped.
--    These can be safely re-published / re-archived with the new safe process.
-- ─────────────────────────────────────────────────────────────────────────────
WITH root_metadata AS (
  SELECT
    m.head_cid,
    m.name,
    m.is_archived,
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
  rm.head_cid,
  rm.name,
  rm.total_size,
  rm.expected_chunks,
  ns.total_nodes,
  ns.nodes_with_data,
  CASE
    WHEN ns.nodes_with_data = ns.total_nodes AND ns.total_nodes >= rm.expected_chunks
    THEN 'SAFE_TO_RE_ARCHIVE'
    WHEN ns.nodes_with_data > 0
    THEN 'PARTIAL_DATA_AVAILABLE'
    ELSE 'NO_DATA'
  END AS recovery_status
FROM root_metadata rm
JOIN node_stats ns ON ns.root_cid = rm.head_cid
WHERE rm.is_archived = true
ORDER BY recovery_status, rm.total_size DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FIND NON-ARCHIVED FILES WITH ALL NODES PUBLISHED (ready for archival)
--    These are files that have piece_index set on all nodes but haven't been
--    marked as archived yet. With the new safe archival, these can be
--    re-processed safely.
-- ─────────────────────────────────────────────────────────────────────────────
WITH root_metadata AS (
  SELECT
    m.head_cid,
    m.name,
    m.is_archived,
    (m.metadata->>'totalSize')::bigint AS total_size
  FROM metadata m
  WHERE m.head_cid = m.root_cid
    AND m.is_archived = false
),
node_stats AS (
  SELECT
    root_cid,
    COUNT(*) AS total_nodes,
    COUNT(*) FILTER (WHERE piece_index IS NOT NULL) AS nodes_with_piece,
    COUNT(*) FILTER (WHERE encoded_node IS NOT NULL) AS nodes_with_data
  FROM nodes
  GROUP BY root_cid
)
SELECT
  rm.head_cid,
  rm.name,
  rm.total_size,
  ns.total_nodes,
  ns.nodes_with_piece,
  ns.nodes_with_data,
  CASE
    WHEN ns.nodes_with_piece = ns.total_nodes THEN 'READY_FOR_ARCHIVAL'
    ELSE 'PUBLISHING_INCOMPLETE'
  END AS status
FROM root_metadata rm
JOIN node_stats ns ON ns.root_cid = rm.head_cid
WHERE ns.total_nodes > 0
ORDER BY status, rm.total_size DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SUMMARY: Categorize ALL archived files by recovery possibility
-- ─────────────────────────────────────────────────────────────────────────────
WITH root_metadata AS (
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
    COUNT(*) FILTER (WHERE encoded_node IS NOT NULL) AS nodes_with_data,
    COUNT(*) FILTER (WHERE piece_index IS NOT NULL) AS nodes_with_mapping
  FROM nodes
  GROUP BY root_cid
)
SELECT
  category,
  COUNT(*) AS file_count,
  pg_size_pretty(SUM(total_size)) AS total_data_size
FROM (
  SELECT
    rm.head_cid,
    rm.total_size,
    CASE
      WHEN COALESCE(ns.total_nodes, 0) = 0
        THEN 'A: ALL_NODES_MISSING (needs DSN re-index or gateway recovery)'
      WHEN ns.nodes_with_data = ns.total_nodes AND ns.total_nodes >= rm.expected_chunks
        THEN 'B: FULL_DATA_IN_DB (can re-archive safely with new code)'
      WHEN ns.nodes_with_data > 0 AND ns.nodes_with_data < ns.total_nodes
        THEN 'C: PARTIAL_DATA (some nodes stripped, need re-publish for missing)'
      WHEN ns.nodes_with_data = 0 AND ns.nodes_with_mapping = ns.total_nodes
        THEN 'D: CORRECTLY_ARCHIVED (data stripped, mappings intact, needs gateway fix)'
      WHEN ns.nodes_with_data = 0 AND ns.nodes_with_mapping < ns.total_nodes
        THEN 'E: PARTIALLY_MAPPED (some mappings missing, partial DSN publish)'
      ELSE 'F: UNKNOWN STATE'
    END AS category
  FROM root_metadata rm
  LEFT JOIN node_stats ns ON ns.root_cid = rm.head_cid
) categorized
GROUP BY category
ORDER BY category;

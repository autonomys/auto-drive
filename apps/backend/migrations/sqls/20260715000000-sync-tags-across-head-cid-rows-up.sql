-- Tags (moderation state: reported/banned/report-dismissed) are semantically
-- per-content (head_cid), but are stored per (root_cid, head_cid) row and
-- historically could diverge: new rows for known content were inserted with
-- NULL tags, and tag updates used to be guarded on one arbitrary row. Bring
-- every row of a head_cid up to the union of its siblings' tags so per-row
-- queries (review queue, download authorization) see a consistent state.
-- Only heads with at least one tagged row are touched, and only rows missing
-- at least one tag are rewritten.
UPDATE metadata m
SET tags = merged.tags
FROM (
  SELECT head_cid, array_agg(DISTINCT tag) AS tags
  FROM metadata, unnest(tags) AS tag
  GROUP BY head_cid
) merged
WHERE m.head_cid = merged.head_cid
  AND NOT (COALESCE(m.tags, '{}') @> merged.tags);

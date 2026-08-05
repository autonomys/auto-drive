-- Make the root blockstore node per upload unique, so a duplicate root node is
-- unrepresentable rather than merely unlikely.
--
-- completeUpload now takes an atomic completion claim, which stops two
-- overlapping calls from both writing the root node. That guard is app-level
-- only, and two holes survive it:
--   * a completion that outlives UPLOAD_COMPLETION_CLAIM_STALE_MS has its claim
--     taken over, and the second run writes the root node again;
--   * during a rolling deploy, an old process has no guard at all.
-- Both leave the duplicate rows that made getFileUploadIdCID — and therefore
-- every future migration attempt — fail permanently. A constraint closes them.
--
-- Scoped to the ROOT node types only. A file containing two identical chunks
-- legitimately stores two rows with the same CID, and
-- processBufferToIPLDFormatFromChunks iterates every FileChunk row to build the
-- DAG links, so deduplicating chunks would silently corrupt such files. Root
-- rows have no such freedom: exactly one File (or Folder) row exists per
-- upload_id, since the intermediate nodes of a chunked file are written as
-- FileInlink, not File (auto-dag-data createFileInlinkIpldNode).

-- Existing duplicates must go first or the index cannot be built. This is
-- lossless: cid is the content hash of the node, so rows sharing
-- (upload_id, cid) are byte-identical in data, node_size and node_type, and
-- keeping the lowest sort_id preserves the row the readers already return
-- (getByType orders by sort_id ASC). Uploads broken this way are still
-- MIGRATING with their payload intact, so this deletion repairs them rather
-- than discarding anything.
-- The index itself is built by the migration's JS, not from this file: it needs
-- CONCURRENTLY, which cannot run inside a transaction block. See the comment
-- there.
DELETE FROM uploads.blockstore AS b
WHERE b.node_type IN ('File', 'Folder')
  AND b.sort_id > (
    SELECT MIN(inner_b.sort_id)
    FROM uploads.blockstore AS inner_b
    WHERE inner_b.upload_id = b.upload_id
      AND inner_b.cid = b.cid
      AND inner_b.node_type = b.node_type
  );

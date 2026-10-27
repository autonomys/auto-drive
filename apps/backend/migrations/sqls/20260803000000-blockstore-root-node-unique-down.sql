-- Drops the constraint only. The duplicate root rows the forward migration
-- removed are not restored: they were byte-identical copies of a row that is
-- still present, so there is nothing to restore.
DROP INDEX IF EXISTS uploads.blockstore_root_node_unique_idx;

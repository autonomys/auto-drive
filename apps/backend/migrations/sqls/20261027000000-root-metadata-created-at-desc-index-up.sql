-- Not redundant with idx_root_metadata_created_at: read backward, an ascending
-- index yields DESC NULLS FIRST, so the file tables' default
-- `created_at: desc_nulls_last` ordering cannot use it.
CREATE INDEX CONCURRENTLY idx_root_metadata_created_at_desc_nulls_last
  ON public.metadata USING btree (created_at DESC NULLS LAST)
  WHERE (root_cid = head_cid);

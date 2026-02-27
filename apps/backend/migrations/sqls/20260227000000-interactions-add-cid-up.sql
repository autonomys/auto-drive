-- Add cid column to interactions table to track which file was accessed
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS cid text NULL;

-- Index for fast lookups by CID
CREATE INDEX IF NOT EXISTS idx_interactions_cid ON public.interactions USING btree (cid);

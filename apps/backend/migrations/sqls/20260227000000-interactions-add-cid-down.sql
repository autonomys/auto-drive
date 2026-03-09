-- Remove cid column from interactions table
DROP INDEX IF EXISTS idx_interactions_cid;
ALTER TABLE public.interactions DROP COLUMN IF EXISTS cid;

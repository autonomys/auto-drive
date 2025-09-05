-- Drop indexes first
DROP INDEX IF EXISTS idx_downloads_cid;
DROP INDEX IF EXISTS idx_downloads_user;

-- Drop the table
DROP TABLE IF EXISTS public.async_downloads;

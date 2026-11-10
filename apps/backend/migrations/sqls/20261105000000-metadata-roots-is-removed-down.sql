-- Never run this where Hasura created these objects, as in production: its
-- metadata relies on them, and nothing would recreate them.
DROP FUNCTION IF EXISTS public.metadata_is_removed(public.metadata);
DROP FUNCTION IF EXISTS public.metadata_roots_is_removed(public.metadata_roots);
DROP VIEW IF EXISTS public.metadata_roots;

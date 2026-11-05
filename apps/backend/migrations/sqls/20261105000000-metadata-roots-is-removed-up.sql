-- Hasura's own SQL migrations used to create these objects, so databases set
-- up before this migration already have them. Each one is created only where
-- it is missing, and an existing one is left exactly as it is. The function
-- bodies keep the exact text Hasura created, unindented, so their source is
-- the same in every database.
DO $migration$
BEGIN
  IF to_regclass('public.metadata_roots') IS NULL THEN
    CREATE VIEW public.metadata_roots AS
    SELECT *
    FROM public.metadata
    WHERE head_cid = root_cid;
  END IF;

  -- Whether an object has been removed: it has an admin owner, and every admin
  -- owner has removed it. Removal is tracked on the root's ownership rows.
  -- Exposed as the `is_removed` computed field on metadata_roots and metadata.
  IF to_regprocedure(
    'public.metadata_roots_is_removed(public.metadata_roots)'
  ) IS NULL THEN
    CREATE FUNCTION public.metadata_roots_is_removed(root public.metadata_roots)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.object_ownership o
    WHERE o.cid = root.root_cid
      AND o.is_admin
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.object_ownership o
    WHERE o.cid = root.root_cid
      AND o.is_admin
      AND o.marked_as_deleted IS NULL
  )
$$;
  END IF;

  IF to_regprocedure('public.metadata_is_removed(public.metadata)') IS NULL THEN
    CREATE FUNCTION public.metadata_is_removed(m public.metadata)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.object_ownership o
    WHERE o.cid = m.root_cid
      AND o.is_admin
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.object_ownership o
    WHERE o.cid = m.root_cid
      AND o.is_admin
      AND o.marked_as_deleted IS NULL
  )
$$;
  END IF;
END
$migration$;

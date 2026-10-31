-- Whether an object has been removed: it has an admin owner, and every admin
-- owner has removed it. Removal is tracked on the root's ownership rows.
-- Exposed as the `is_removed` computed field on metadata_roots and metadata.
CREATE OR REPLACE FUNCTION public.metadata_roots_is_removed(root public.metadata_roots)
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

CREATE OR REPLACE FUNCTION public.metadata_is_removed(m public.metadata)
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

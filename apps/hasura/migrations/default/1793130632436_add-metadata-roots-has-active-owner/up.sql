-- Whether a root object still has an admin owner who has not removed it.
-- Exposed as the `has_active_owner` computed field on metadata_roots.
CREATE OR REPLACE FUNCTION public.metadata_roots_has_active_owner(root public.metadata_roots)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.object_ownership o
    WHERE o.cid = root.root_cid
      AND o.is_admin
      AND o.marked_as_deleted IS NULL
  )
$$;

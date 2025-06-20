-- users_organizations
DROP INDEX IF EXISTS public.idx_users_organizations_organization_id;

-- interactions
DROP INDEX IF EXISTS public.idx_interactions_subscription_id;

-- nodes
DROP INDEX IF EXISTS public.idx_nodes_root_cid;
DROP INDEX IF EXISTS public.idx_nodes_head_cid;

-- published_objects
DROP INDEX IF EXISTS public.idx_published_objects_cid;

-- metadata
DROP INDEX IF EXISTS public.idx_metadata_head_cid;

CREATE VIEW public.metadata_roots AS
SELECT *
FROM public.metadata
WHERE head_cid = root_cid;
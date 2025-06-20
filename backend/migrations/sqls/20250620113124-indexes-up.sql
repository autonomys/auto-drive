-- metadata
CREATE INDEX idx_metadata_head_cid ON public.metadata (head_cid);

-- published_objects
CREATE INDEX idx_published_objects_cid ON public.published_objects (cid);

-- nodes
CREATE INDEX idx_nodes_head_cid ON public.nodes (head_cid);
CREATE INDEX idx_nodes_root_cid ON public.nodes (root_cid);

-- interactions
CREATE INDEX idx_interactions_subscription_id ON public.interactions (subscription_id);

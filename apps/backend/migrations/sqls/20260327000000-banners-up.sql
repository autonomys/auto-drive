-- Banners table
CREATE TABLE public.banners (
    id text NOT NULL DEFAULT gen_random_uuid()::text,
    title text NOT NULL,
    body text NOT NULL,
    criticality text NOT NULL DEFAULT 'info',
    dismissable boolean NOT NULL DEFAULT true,
    requires_acknowledgement boolean NOT NULL DEFAULT false,
    display_start timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    display_end timestamp NULL,
    active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT banners_pkey PRIMARY KEY (id),
    CONSTRAINT banners_criticality_check CHECK (criticality IN ('info', 'warning', 'critical'))
);

CREATE INDEX idx_banners_active ON public.banners (active, display_start, display_end);

-- Banner interactions table
CREATE TABLE public.banner_interactions (
    id text NOT NULL DEFAULT gen_random_uuid()::text,
    user_id text NOT NULL,
    banner_id text NOT NULL,
    interaction_type text NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT banner_interactions_pkey PRIMARY KEY (id),
    CONSTRAINT banner_interactions_banner_fk FOREIGN KEY (banner_id) REFERENCES public.banners(id) ON DELETE CASCADE,
    CONSTRAINT banner_interactions_type_check CHECK (interaction_type IN ('acknowledged', 'dismissed')),
    CONSTRAINT banner_interactions_unique UNIQUE (user_id, banner_id, interaction_type)
);

CREATE INDEX idx_banner_interactions_user ON public.banner_interactions (user_id);
CREATE INDEX idx_banner_interactions_banner ON public.banner_interactions (banner_id);

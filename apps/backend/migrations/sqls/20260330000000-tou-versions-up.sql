CREATE TABLE public.tou_versions (
  id text NOT NULL DEFAULT gen_random_uuid()::text,
  version_label text NOT NULL,
  effective_date timestamp NOT NULL,
  content_url text NOT NULL,
  change_type text NOT NULL DEFAULT 'material',
  status text NOT NULL DEFAULT 'draft',
  admin_notes text,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tou_versions_pkey PRIMARY KEY (id),
  CONSTRAINT tou_versions_change_type_check CHECK (change_type IN ('material', 'non-material')),
  CONSTRAINT tou_versions_status_check CHECK (status IN ('draft', 'pending', 'active', 'archived')),
  CONSTRAINT tou_versions_version_label_unique UNIQUE (version_label)
);

CREATE INDEX idx_tou_versions_status ON public.tou_versions (status);
CREATE INDEX idx_tou_versions_effective_date ON public.tou_versions (effective_date);

CREATE TABLE public.user_tou_acceptance (
  id text NOT NULL DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL,
  version_id text NOT NULL,
  ip_address text,
  accepted_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_tou_acceptance_pkey PRIMARY KEY (id),
  CONSTRAINT user_tou_acceptance_version_fk FOREIGN KEY (version_id) REFERENCES public.tou_versions(id) ON DELETE CASCADE,
  CONSTRAINT user_tou_acceptance_unique UNIQUE (user_id, version_id)
);

CREATE INDEX idx_user_tou_acceptance_user ON public.user_tou_acceptance (user_id);
CREATE INDEX idx_user_tou_acceptance_version ON public.user_tou_acceptance (version_id);

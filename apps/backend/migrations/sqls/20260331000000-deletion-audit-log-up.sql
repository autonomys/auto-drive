CREATE TABLE public.deletion_audit_log (
  id text NOT NULL DEFAULT gen_random_uuid()::text,
  user_public_id text NOT NULL,
  action text NOT NULL,
  details jsonb NULL,
  performed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT deletion_audit_log_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_deletion_audit_log_user ON public.deletion_audit_log (user_public_id);
CREATE INDEX idx_deletion_audit_log_performed ON public.deletion_audit_log (performed_at);

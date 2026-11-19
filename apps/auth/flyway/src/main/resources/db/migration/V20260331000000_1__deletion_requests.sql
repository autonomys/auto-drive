CREATE TABLE users.deletion_requests (
  id text NOT NULL DEFAULT gen_random_uuid()::text,
  user_public_id text NOT NULL,
  oauth_provider text NOT NULL,
  oauth_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_anonymisation_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  reason text NULL,
  admin_notes text NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT deletion_requests_pkey PRIMARY KEY (id),
  CONSTRAINT deletion_requests_status_check CHECK (status IN ('pending', 'cancelled', 'processing', 'completed', 'failed'))
);

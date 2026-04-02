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
  CONSTRAINT deletion_requests_status_check CHECK (status IN ('pending', 'cancelled', 'processing', 'completed', 'failed')),
  CONSTRAINT deletion_requests_user_fk FOREIGN KEY (oauth_provider, oauth_user_id)
    REFERENCES users.users(oauth_provider, oauth_user_id)
);

CREATE INDEX idx_deletion_requests_status ON users.deletion_requests (status);
CREATE INDEX idx_deletion_requests_scheduled ON users.deletion_requests (scheduled_anonymisation_at) WHERE status = 'pending';
CREATE INDEX idx_deletion_requests_user ON users.deletion_requests (user_public_id);

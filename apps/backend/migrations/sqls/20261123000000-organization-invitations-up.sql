-- Invitations to join a partner organisation. Organisation admins invite a user
-- by public ID and the user joins only by accepting, so nobody is moved into an
-- organisation without their consent. Organisations and users live in the auth
-- database, so they are referenced by ID without foreign keys.
CREATE TABLE public.organization_invitations (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  -- The invited user.
  public_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  -- Public ID of who sent (or last re-sent) it.
  invited_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  -- At most one outcome.
  CONSTRAINT organization_invitations_one_outcome
    CHECK (num_nonnulls(accepted_at, declined_at, revoked_at) <= 1)
);

-- One open invitation per user and organisation; inviting again refreshes it.
CREATE UNIQUE INDEX organization_invitations_open_key
  ON public.organization_invitations (organization_id, public_id)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

-- A user's open invitations, for the banner shown to them.
CREATE INDEX organization_invitations_open_public_id_idx
  ON public.organization_invitations (public_id)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

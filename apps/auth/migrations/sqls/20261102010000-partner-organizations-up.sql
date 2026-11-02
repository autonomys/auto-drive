-- Production runs on Aurora DSQL, which takes one DDL statement per
-- transaction, builds indexes asynchronously (CREATE INDEX ASYNC) and adds
-- columns with a name and type only. Apply it there statement by statement,
-- as described in PR #933.

-- Organisation admins manage an organisation; members use its account. The
-- column is nullable because DSQL can neither add a NOT NULL column to a table
-- with rows nor backfill one in a single transaction. Memberships from before
-- this column are all personal organisations, which their user administers,
-- so NULL reads as 'admin'. New memberships always state their role.
ALTER TABLE users.users_organizations ADD COLUMN role text;
ALTER TABLE users.users_organizations
  ADD CONSTRAINT users_organizations_role_check
  CHECK (role IN ('admin', 'member')) NOT VALID;

-- Every move into, out of or within an organisation, made by an Auto Drive
-- admin. Removing a user from an organisation restores the organisation they
-- were moved in from, which is found here.
CREATE TABLE users.organization_membership_changes (
  id text NOT NULL,
  oauth_provider text NOT NULL,
  oauth_user_id text NOT NULL,
  from_organization_id text NULL,
  to_organization_id text NULL,
  role text NULL,
  actor text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_membership_changes_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_organization_membership_changes_from
  ON users.organization_membership_changes (from_organization_id);
CREATE INDEX idx_organization_membership_changes_to
  ON users.organization_membership_changes (to_organization_id);
CREATE INDEX idx_organization_membership_changes_user
  ON users.organization_membership_changes (oauth_provider, oauth_user_id);

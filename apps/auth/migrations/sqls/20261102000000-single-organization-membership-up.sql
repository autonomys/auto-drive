-- Production runs on Aurora DSQL, which takes one DDL statement per
-- transaction and builds indexes asynchronously (CREATE UNIQUE INDEX ASYNC).
-- Apply it there statement by statement, as described in PR #932.

-- Organisations are archived rather than deleted so their history survives a
-- member moving to another organisation.
ALTER TABLE users.organizations ADD COLUMN archived_at timestamp;

-- A user belongs to exactly one organisation at a time. Leaving an
-- organisation removes the membership row, so every row is an active
-- membership.
CREATE UNIQUE INDEX users_organizations_user_key
  ON users.users_organizations (oauth_provider, oauth_user_id);

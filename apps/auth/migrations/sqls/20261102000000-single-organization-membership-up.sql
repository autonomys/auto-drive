-- Production runs on Aurora DSQL, which takes one DDL statement per
-- transaction and builds indexes asynchronously (CREATE UNIQUE INDEX ASYNC).
-- Apply it there statement by statement, as described in PR #932.

-- Organisations are archived rather than deleted so their history survives a
-- member moving to another organisation.
ALTER TABLE users.organizations ADD COLUMN archived_at timestamp;

-- Older code could write a user's membership twice. Keep each user's first
-- row, which the old unordered lookup returned, so nobody changes
-- organisation. Production (DSQL) is checked for duplicates by hand instead.
DELETE FROM users.users_organizations a
  USING users.users_organizations b
  WHERE a.oauth_provider = b.oauth_provider
    AND a.oauth_user_id = b.oauth_user_id
    AND a.ctid > b.ctid;

-- A user belongs to exactly one organisation at a time. Leaving an
-- organisation removes the membership row, so every row is an active
-- membership.
CREATE UNIQUE INDEX users_organizations_user_key
  ON users.users_organizations (oauth_provider, oauth_user_id);

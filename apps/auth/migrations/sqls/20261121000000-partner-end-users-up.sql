-- Production runs on Aurora DSQL, which takes one DDL statement per
-- transaction, adds columns with a name and type only and builds indexes
-- asynchronously (CREATE UNIQUE INDEX ASYNC). Apply it there statement by
-- statement, as docs/auth.md lists them.

-- Partner end users are a partner organisation's customers, enrolled by the
-- partner through the backend. They are members of its organisation with role
-- 'partner_end_user', which only enrolment gives. NOT VALID skips checking the
-- existing rows, as when the constraint was added.
ALTER TABLE users.users_organizations
  DROP CONSTRAINT users_organizations_role_check;
ALTER TABLE users.users_organizations
  ADD CONSTRAINT users_organizations_role_check
  CHECK (role IN ('admin', 'member', 'partner_end_user')) NOT VALID;

-- What the partner gave for each end user: its own reference for them and
-- their upload quota (NULL for the account's default). Removing an end user
-- sets end_user_removed_at and keeps the row, so they stay read-only in the
-- organisation and enrolling them again clears it. All three are NULL for
-- everyone else.
ALTER TABLE users.users_organizations ADD COLUMN customer_reference text;
ALTER TABLE users.users_organizations ADD COLUMN upload_quota_bytes bigint;
ALTER TABLE users.users_organizations ADD COLUMN end_user_removed_at timestamp;

-- A customer reference belongs to one end user of an organisation, removed or
-- not, so it is never reused for another person. NULLs are distinct, so
-- members, who have none, are not affected.
CREATE UNIQUE INDEX users_organizations_customer_reference_key
  ON users.users_organizations (organization_id, customer_reference);

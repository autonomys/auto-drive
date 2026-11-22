-- End users are a partner organisation's customers, enrolled by the partner
-- through the backend. They are members of its organisation with role
-- 'end_user', which only enrolment gives.
--
-- Production runs on Aurora DSQL, which takes one DDL statement per
-- transaction: apply these two statements one at a time. NOT VALID skips
-- checking the existing rows, as when the constraint was added.
ALTER TABLE users.users_organizations
  DROP CONSTRAINT users_organizations_role_check;
ALTER TABLE users.users_organizations
  ADD CONSTRAINT users_organizations_role_check
  CHECK (role IN ('admin', 'member', 'end_user')) NOT VALID;

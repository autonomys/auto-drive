ALTER TABLE users.users_organizations
  DROP CONSTRAINT IF EXISTS users_organizations_role_check;
ALTER TABLE users.users_organizations
  ADD CONSTRAINT users_organizations_role_check
  CHECK (role IN ('admin', 'member')) NOT VALID;

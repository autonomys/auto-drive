DROP INDEX IF EXISTS users.users_organizations_customer_reference_key;
ALTER TABLE users.users_organizations DROP COLUMN IF EXISTS end_user_removed_at;
ALTER TABLE users.users_organizations DROP COLUMN IF EXISTS upload_quota_bytes;
ALTER TABLE users.users_organizations DROP COLUMN IF EXISTS customer_reference;
ALTER TABLE users.users_organizations
  DROP CONSTRAINT IF EXISTS users_organizations_role_check;
ALTER TABLE users.users_organizations
  ADD CONSTRAINT users_organizations_role_check
  CHECK (role IN ('admin', 'member')) NOT VALID;

DROP INDEX IF EXISTS users.users_organizations_user_key;
ALTER TABLE users.organizations DROP COLUMN IF EXISTS archived_at;

DROP TABLE IF EXISTS users.organization_membership_changes;
ALTER TABLE users.users_organizations DROP COLUMN IF EXISTS role;

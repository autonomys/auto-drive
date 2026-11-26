ALTER TABLE users.organization_membership_changes
  DROP COLUMN IF EXISTS upload_quota_bytes;
ALTER TABLE users.organization_membership_changes
  DROP COLUMN IF EXISTS end_user_change;
ALTER TABLE users.users_organizations DROP COLUMN IF EXISTS end_user_closed_at;

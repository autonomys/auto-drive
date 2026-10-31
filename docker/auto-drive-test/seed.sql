-- One onboarded user in its own organization, with the test access key.
-- psql variable: key.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users.users (oauth_provider, oauth_user_id, oauth_username, public_id, role)
VALUES ('test', 'auto-drive-test', 'auto-drive-test', 'auto-drive-test', 'User')
ON CONFLICT (oauth_provider, oauth_user_id) DO NOTHING;

INSERT INTO users.organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'auto-drive-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users.users_organizations (oauth_provider, oauth_user_id, organization_id)
SELECT 'test', 'auto-drive-test', '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (
  SELECT 1 FROM users.users_organizations
  WHERE oauth_provider = 'test' AND oauth_user_id = 'auto-drive-test'
);

INSERT INTO users.api_keys (id, name, secret, oauth_provider, oauth_user_id)
VALUES ('00000000-0000-0000-0000-000000000001', 'auto-drive-test', :'key', 'test', 'auto-drive-test')
ON CONFLICT (id) DO UPDATE SET secret = EXCLUDED.secret, deleted_at = NULL;

COMMIT;

CREATE TABLE users.users_organizations (
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	organization_id text NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP
);

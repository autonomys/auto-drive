CREATE TABLE users.users (
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	public_id text NULL,
	"role" text NOT NULL DEFAULT 'User'::text,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT users_handle_key UNIQUE (public_id),
	CONSTRAINT users_pkey PRIMARY KEY (oauth_provider, oauth_user_id)
);

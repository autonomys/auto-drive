CREATE TABLE users.api_keys (
	id text NOT NULL,
	secret text NOT NULL,
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	deleted_at timestamp NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,

	CONSTRAINT api_keys_pkey PRIMARY KEY (id)
);

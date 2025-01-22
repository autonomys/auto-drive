create schema users;

/* Replace with your SQL commands */
-- users.jwt_token_registry definition

-- Drop table

-- DROP TABLE users.jwt_token_registry;

CREATE TABLE users.jwt_token_registry (
	id text NOT NULL,
	createdat timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT jwt_token_registry_pkey PRIMARY KEY (id)
);


-- users.organizations definition

-- Drop table

-- DROP TABLE users.organizations;

CREATE TABLE users.organizations (
	id text NOT NULL,
	"name" text NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT organizations_pkey PRIMARY KEY (id)
);


-- users.users definition

-- Drop table

-- DROP TABLE users.users;

CREATE TABLE users.users (
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	public_id text NULL,
	"role" text NOT NULL DEFAULT 'User'::text,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT users_handle_key UNIQUE (public_id),
	CONSTRAINT users_pkey PRIMARY KEY (oauth_provider, oauth_user_id)
);


-- users.api_keys definition

-- Drop table

-- DROP TABLE users.api_keys;

CREATE TABLE users.api_keys (
	id text NOT NULL,
	secret text NOT NULL,
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	deleted_at timestamp NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	
	CONSTRAINT api_keys_pkey PRIMARY KEY (id)
);

-- users.users_organizations definition

-- Drop table

-- DROP TABLE users.users_organizations;

CREATE TABLE users.users_organizations (
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	organization_id text NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP
);
create schema users;

CREATE OR REPLACE FUNCTION users.trigger_set_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;


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
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT organizations_pkey PRIMARY KEY (id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    users.organizations for each row execute function trigger_set_timestamp();


-- users.users definition

-- Drop table

-- DROP TABLE users.users;

CREATE TABLE users.users (
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	public_id text NULL,
	"role" text NOT NULL DEFAULT 'User'::text,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT users_handle_key UNIQUE (public_id),
	CONSTRAINT users_pkey PRIMARY KEY (oauth_provider, oauth_user_id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    users.users for each row execute function trigger_set_timestamp();


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
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT api_keys_pkey PRIMARY KEY (id),
	CONSTRAINT fk_user_id FOREIGN KEY (oauth_provider,oauth_user_id) REFERENCES users.users(oauth_provider,oauth_user_id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    users.api_keys for each row execute function trigger_set_timestamp();


-- users.users_organizations definition

-- Drop table

-- DROP TABLE users.users_organizations;

CREATE TABLE users.users_organizations (
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	organization_id text NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_organization_id FOREIGN KEY (organization_id) REFERENCES users.organizations(id),
	CONSTRAINT fk_user_id FOREIGN KEY (oauth_provider,oauth_user_id) REFERENCES users.users(oauth_provider,oauth_user_id)
);
CREATE TABLE users.organizations (
	id text NOT NULL,
	"name" text NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT organizations_pkey PRIMARY KEY (id)
);

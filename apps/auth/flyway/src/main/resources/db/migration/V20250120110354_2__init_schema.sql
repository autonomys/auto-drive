CREATE TABLE users.jwt_token_registry (
	id text NOT NULL,
	createdat timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT jwt_token_registry_pkey PRIMARY KEY (id)
);

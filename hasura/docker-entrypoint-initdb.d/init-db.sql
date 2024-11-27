\c postgres
CREATE EXTENSION IF NOT EXISTS btree_gist;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Schemas creation by Hasura
CREATE SCHEMA download_cache AUTHORIZATION postgres;
CREATE SCHEMA uploads AUTHORIZATION postgres;

CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tables creation by Hasura
-- public.metadata definition

-- Drop table

-- DROP TABLE public.metadata;

CREATE TABLE public.metadata (
	root_cid text NOT NULL,
	head_cid text NOT NULL,
	metadata jsonb NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT metadata_pkey PRIMARY KEY (root_cid, head_cid)
);


-- Table Triggers

create trigger set_timestamp before
update
    on
    public.metadata for each row execute function public.trigger_set_timestamp();


-- public.migrations definition

-- Drop table

-- DROP TABLE public.migrations;

CREATE TABLE public.migrations (
	id serial4 NOT NULL,
	"name" varchar(255) NOT NULL,
	run_on timestamp NOT NULL,
	CONSTRAINT migrations_pkey PRIMARY KEY (id)
);


-- public.nodes definition

-- Drop table

-- DROP TABLE public.nodes;

CREATE TABLE public.nodes (
	cid text NOT NULL,
	root_cid text NULL,
	head_cid text NULL,
	"type" text NULL,
	encoded_node text NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	piece_index int4 NULL,
	piece_offset int4 NULL,
	CONSTRAINT nodes_pkey PRIMARY KEY (cid)
);
CREATE INDEX nodes_head_cid ON public.nodes USING btree (head_cid);

-- Table Triggers

create trigger set_timestamp before
update
    on
    public.nodes for each row execute function public.trigger_set_timestamp();


-- public.object_ownership definition

-- Drop table

-- DROP TABLE public.object_ownership;

CREATE TABLE public.object_ownership (
	cid text NOT NULL,
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	is_admin bool NULL,
	marked_as_deleted timestamp NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT object_ownership_pkey PRIMARY KEY (cid, oauth_provider, oauth_user_id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    public.object_ownership for each row execute function public.trigger_set_timestamp();


-- public.organizations definition

-- Drop table

-- DROP TABLE public.organizations;

CREATE TABLE public.organizations (
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
    public.organizations for each row execute function public.trigger_set_timestamp();


-- public.transaction_results definition

-- Drop table

-- DROP TABLE public.transaction_results;

CREATE TABLE public.transaction_results (
	cid text NOT NULL,
	transaction_result jsonb NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT transaction_results_pkey PRIMARY KEY (cid),
    CONSTRAINT nodes_fkey FOREIGN KEY (cid) REFERENCES public.nodes(cid)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    public.transaction_results for each row execute function public.trigger_set_timestamp();


-- public.users definition

-- Drop table

-- DROP TABLE public.users;

CREATE TABLE public.users (
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
    public.users for each row execute function public.trigger_set_timestamp();


-- public.api_keys definition

-- Drop table

-- DROP TABLE public.api_keys;

CREATE TABLE public.api_keys (
	id text NOT NULL,
	secret text NOT NULL,
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	deleted_at timestamp NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT api_keys_pkey PRIMARY KEY (id),
	CONSTRAINT fk_user_id FOREIGN KEY (oauth_provider,oauth_user_id) REFERENCES public.users(oauth_provider,oauth_user_id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    public.api_keys for each row execute function public.trigger_set_timestamp();


-- public.subscriptions definition

-- Drop table

-- DROP TABLE public.subscriptions;

CREATE TABLE public.subscriptions (
	id text NOT NULL,
	organization_id text NOT NULL,
	granularity text NOT NULL,
	upload_limit int8 NOT NULL,
	download_limit int8 NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
	CONSTRAINT fk_organization_id FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    public.subscriptions for each row execute function public.trigger_set_timestamp();


-- public.users_organizations definition

-- Drop table

-- DROP TABLE public.users_organizations;

CREATE TABLE public.users_organizations (
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	organization_id text NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_organization_id FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
	CONSTRAINT fk_user_id FOREIGN KEY (oauth_provider,oauth_user_id) REFERENCES public.users(oauth_provider,oauth_user_id)
);


-- public.interactions definition

-- Drop table

-- DROP TABLE public.interactions;

CREATE TABLE public.interactions (
	id text NOT NULL,
	subscription_id text NOT NULL,
	"type" text NOT NULL,
	"size" int8 NOT NULL,
	created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_subscription_id FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id)
);

-- Table Triggers

create trigger set_timestamp before
update
    on
    public.interactions for each row execute function public.trigger_set_timestamp();

-- End of file

-- download_cache.file_parts definition

-- Drop table

-- DROP TABLE download_cache.file_parts;

CREATE TABLE download_cache.file_parts (
	cid text NOT NULL,
	"index" int4 NOT NULL,
	"data" bytea NOT NULL,
	CONSTRAINT file_parts_pkey PRIMARY KEY (cid, index)
);


-- download_cache.registry definition

-- Drop table

-- DROP TABLE download_cache.registry;

CREATE TABLE download_cache.registry (
	cid text NOT NULL,
	last_accessed_at timestamptz NOT NULL,
	"size" int8 NOT NULL,
	CONSTRAINT registry_pkey PRIMARY KEY (cid)
);

-- uploads.blockstore definition

-- Drop table

-- DROP TABLE uploads.blockstore;

CREATE TABLE uploads.blockstore (
	sort_id serial4 NOT NULL,
	upload_id text NOT NULL,
	cid text NOT NULL,
	node_type text NOT NULL,
	node_size int8 NOT NULL,
	"data" bytea NOT NULL,
	created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT blockstore_pkey PRIMARY KEY (sort_id)
);
CREATE INDEX blockstore_upload_id_cid_index ON uploads.blockstore USING btree (upload_id, cid);

-- Table Triggers

create trigger set_timestamp after
update
    on
    uploads.blockstore for each row execute function public.trigger_set_timestamp();


-- uploads.file_parts definition

-- Drop table

-- DROP TABLE uploads.file_parts;

CREATE TABLE uploads.file_parts (
	upload_id text NOT NULL,
	part_index int4 NOT NULL,
	"data" bytea NOT NULL,
	created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT file_parts_pkey PRIMARY KEY (upload_id, part_index)
);

-- Table Triggers

create trigger set_timestamp after
update
    on
    uploads.file_parts for each row execute function public.trigger_set_timestamp();


-- uploads.file_processing_info definition

-- Drop table

-- DROP TABLE uploads.file_processing_info;

CREATE TABLE uploads.file_processing_info (
	upload_id text NOT NULL,
	last_processed_part_index int4 NULL,
	pending_bytes bytea NULL,
	created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT file_processing_info_pkey PRIMARY KEY (upload_id)
);

-- Table Triggers

create trigger set_timestamp after
update
    on
    uploads.file_processing_info for each row execute function public.trigger_set_timestamp();


-- uploads.uploads definition

-- Drop table

-- DROP TABLE uploads.uploads;

CREATE TABLE uploads.uploads (
	id text NOT NULL,
	oauth_provider text NOT NULL,
	oauth_user_id text NOT NULL,
	root_upload_id text NULL,
	relative_id text NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	file_tree jsonb NULL,
	status text NOT NULL,
	mime_type text NULL,
	created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	upload_options jsonb NULL,
	CONSTRAINT uploads_pkey PRIMARY KEY (id)
);

-- Table Triggers

create trigger set_timestamp after
update
    on
    uploads.uploads for each row execute function public.trigger_set_timestamp();


-- uploads.blockstore foreign keys

ALTER TABLE uploads.blockstore ADD CONSTRAINT blockstore_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES uploads.uploads(id) ON DELETE CASCADE;


-- uploads.file_parts foreign keys

ALTER TABLE uploads.file_parts ADD CONSTRAINT file_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES uploads.uploads(id) ON DELETE CASCADE;


-- uploads.file_processing_info foreign keys

ALTER TABLE uploads.file_processing_info ADD CONSTRAINT file_processing_info_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES uploads.uploads(id) ON DELETE CASCADE;


-- uploads.uploads foreign keys

ALTER TABLE uploads.uploads ADD CONSTRAINT uploads_oauth_provider_oauth_user_id_fkey FOREIGN KEY (oauth_provider,oauth_user_id) REFERENCES public.users(oauth_provider,oauth_user_id);

-- jwt_token_registry definition

CREATE TABLE public.jwt_token_registry (
    id TEXT PRIMARY KEY,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE metadata ADD COLUMN "name" TEXT DEFAULT '';
UPDATE metadata SET "name" = metadata->>'name';

-- End of file
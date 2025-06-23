-- First drop tables in uploads schema with foreign key dependencies
DROP TABLE IF EXISTS uploads.file_processing_info;
DROP TABLE IF EXISTS uploads.file_parts;
DROP TABLE IF EXISTS uploads.blockstore;
DROP TABLE IF EXISTS uploads.uploads;

-- Drop uploads schema
DROP SCHEMA IF EXISTS uploads;

-- Drop tables with foreign key constraints in public schema
DROP TABLE IF EXISTS public.users_organizations;
DROP TABLE IF EXISTS public.interactions;
DROP TABLE IF EXISTS public.api_keys;

-- Drop tables without foreign key dependencies
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.transaction_results;
DROP TABLE IF EXISTS public.subscriptions;
DROP TABLE IF EXISTS public.published_objects;
DROP TABLE IF EXISTS public.organizations;
DROP TABLE IF EXISTS public.object_ownership;
DROP TABLE IF EXISTS public.nodes;
DROP TABLE IF EXISTS public.metadata;
DROP TABLE IF EXISTS public.jwt_token_registry;

-- Finally drop the trigger function
DROP FUNCTION IF EXISTS trigger_set_timestamp();

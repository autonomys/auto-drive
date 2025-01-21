DROP TRIGGER IF EXISTS set_timestamp ON users.api_keys;
DROP TRIGGER IF EXISTS set_timestamp ON users.users;
DROP TRIGGER IF EXISTS set_timestamp ON users.organizations;

DROP TABLE IF EXISTS users.users_organizations;
DROP TABLE IF EXISTS users.api_keys;
DROP TABLE IF EXISTS users.users;
DROP TABLE IF EXISTS users.organizations;
DROP TABLE IF EXISTS users.jwt_token_registry;

DROP FUNCTION IF EXISTS users.trigger_set_timestamp();

DROP SCHEMA IF EXISTS users;

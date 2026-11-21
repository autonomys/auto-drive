-- What an organisation API key may be used for: a comma-separated, sorted list
-- of scopes (files, end_users, usage). NULL is full access, which every
-- existing key and every personal key keeps.
--
-- Production runs on Aurora DSQL, which adds columns with a name and type
-- only, so this is the whole migration there.
ALTER TABLE users.api_keys ADD COLUMN scopes text;

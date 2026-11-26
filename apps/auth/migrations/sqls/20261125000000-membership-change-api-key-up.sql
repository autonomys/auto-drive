-- The organisation API key behind a membership change. Every organisation key
-- acts as the organisation's service user, so the actor alone can't tell which
-- key enrolled or removed a partner end user, or which key to revoke. NULL for
-- changes made by a person.
--
-- Production runs on Aurora DSQL: this is the whole migration there.
ALTER TABLE users.organization_membership_changes
  ADD COLUMN actor_api_key_id text;

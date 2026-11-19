CREATE INDEX ASYNC idx_api_keys_owner
  ON users.api_keys (oauth_provider, oauth_user_id)
  WHERE deleted_at IS NULL;

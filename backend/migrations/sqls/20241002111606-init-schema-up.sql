-- Metadata
CREATE TABLE metadata (
  root_cid TEXT,
  head_cid TEXT PRIMARY KEY,
  metadata jsonb
);
-- Nodes
-- 
CREATE TABLE nodes (
  cid TEXT PRIMARY KEY,
  root_cid TEXT,
  head_cid TEXT,
  type TEXT,
  encoded_node TEXT
);
CREATE INDEX nodes_head_cid ON nodes (head_cid);
-- Transaction Results
CREATE TABLE transaction_results (
  cid TEXT PRIMARY KEY,
  transaction_result jsonb
);
-- Users
CREATE TABLE users (
  oauth_provider TEXT,
  oauth_user_id TEXT,
  handle TEXT UNIQUE,
  PRIMARY KEY (oauth_provider, oauth_user_id)
);
-- Object Ownership
CREATE TABLE object_ownership (
  cid TEXT,
  oauth_provider TEXT,
  oauth_user_id TEXT,
  is_admin BOOLEAN,
  marked_as_deleted TIMESTAMP,
  PRIMARY KEY (cid, oauth_provider, oauth_user_id)
);
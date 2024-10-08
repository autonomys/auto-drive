-- Metadata
CREATE TABLE metadata (cid TEXT PRIMARY KEY, metadata jsonb);
-- Nodes
-- 
CREATE TABLE nodes (
  cid TEXT PRIMARY KEY,
  head_cid TEXT,
  type TEXT,
  encoded_node TEXT
);
CREATE INDEX nodes_head_cid ON nodes (head_cid);
-- Transaction Results
CREATE TABLE transaction_results (
  cid TEXT PRIMARY KEY,
  transaction_result jsonb,
  head_cid TEXT
);
-- Users
CREATE TABLE users (
  oauth_provider TEXT,
  oauth_user_id TEXT,
  handle TEXT,
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
-- Metadata
CREATE TABLE IF NOT EXISTS metadata (cid TEXT PRIMARY KEY, metadata jsonb);
-- Nodes
-- 
CREATE TABLE IF NOT EXISTS nodes (
  cid TEXT PRIMARY KEY,
  head_cid TEXT,
  type TEXT,
  encoded_node TEXT
);
CREATE INDEX IF NOT EXISTS nodes_head_cid ON nodes (head_cid);
-- Transaction Results
CREATE TABLE IF NOT EXISTS transaction_results (
  cid TEXT PRIMARY KEY,
  transaction_result jsonb,
  head_cid TEXT
);
-- Object Ownership
CREATE TABLE IF NOT EXISTS object_ownership (
  cid TEXT,
  oauth_provider TEXT,
  oauth_user_id TEXT,
  is_admin BOOLEAN,
  marked_as_deleted TIMESTAMP,
  PRIMARY KEY (cid, oauth_provider, oauth_user_id)
);
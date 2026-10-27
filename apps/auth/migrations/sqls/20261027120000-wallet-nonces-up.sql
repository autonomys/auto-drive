-- One-time nonces handed out for wallet (SIWE) sign-in. A row is deleted when
-- its sign-in completes, and expired rows are pruned when new ones are issued.
CREATE TABLE users.wallet_nonces (
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT wallet_nonces_pkey PRIMARY KEY (nonce)
);

CREATE INDEX idx_wallet_nonces_expires_at ON users.wallet_nonces (expires_at);

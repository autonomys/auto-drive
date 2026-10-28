-- Nonces that wallet (SIWE) sign-ins have used, kept until they expire so each
-- nonce works once. Expired rows are pruned when new ones are recorded.
CREATE TABLE users.wallet_nonces (
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT wallet_nonces_pkey PRIMARY KEY (nonce)
);

CREATE INDEX idx_wallet_nonces_expires_at ON users.wallet_nonces (expires_at);

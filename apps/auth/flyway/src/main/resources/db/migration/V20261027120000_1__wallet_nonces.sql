CREATE TABLE users.wallet_nonces (
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT wallet_nonces_pkey PRIMARY KEY (nonce)
);

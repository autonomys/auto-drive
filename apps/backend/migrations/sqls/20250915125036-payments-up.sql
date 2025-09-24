
CREATE TABLE intents (
  id VARCHAR(255) PRIMARY KEY,
  user_public_id VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  tx_hash VARCHAR(255),
  payment_amount numeric(78,0),
  price_per_mb float
);

ALTER TABLE intents
  DROP COLUMN IF EXISTS usd_rate_at_creation,
  DROP COLUMN IF EXISTS quoted_token_amount,
  DROP COLUMN IF EXISTS token_amount,
  DROP COLUMN IF EXISTS payment_method;

ALTER TABLE purchased_credits
  DROP COLUMN IF EXISTS refunded,
  DROP COLUMN IF EXISTS refunded_at;

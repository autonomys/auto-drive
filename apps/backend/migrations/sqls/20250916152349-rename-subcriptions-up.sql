-- accounts
ALTER TABLE subscriptions RENAME COLUMN granularity TO model;
ALTER TABLE subscriptions RENAME TO accounts;

-- interactions
ALTER TABLE interactions RENAME COLUMN subscription_id TO account_id;
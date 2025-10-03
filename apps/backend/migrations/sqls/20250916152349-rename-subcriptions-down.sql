-- accounts
ALTER TABLE accounts RENAME TO subscriptions;
ALTER TABLE subscriptions RENAME COLUMN model TO granularity;

-- interactions
ALTER TABLE interactions RENAME COLUMN account_id TO subscription_id;
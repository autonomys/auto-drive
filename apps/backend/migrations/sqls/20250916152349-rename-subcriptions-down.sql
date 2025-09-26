ALTER TABLE accounts RENAME TO subscriptions;
ALTER TABLE subscriptions RENAME COLUMN model TO granularity;

-- Rollback: remove the purchased_credits table and its indexes.
-- Indexes are dropped automatically with the table.
DROP TABLE IF EXISTS purchased_credits;

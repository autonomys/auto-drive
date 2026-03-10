-- Add source column to interactions table.
--
-- Tracks whether a given interaction was charged against purchased credits
-- or against the account's free/one-off allocation. This is required so
-- that the free-balance calculation (upload_limit - sum(interactions)) only
-- counts interactions that actually consumed the free allocation, not ones
-- that were already paid for by purchased credits.
--
-- Existing rows are backfilled as 'free_tier' — a safe assumption because
-- purchased credits did not exist before this migration.

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'free_tier'
    CHECK (source IN ('free_tier', 'purchased'));

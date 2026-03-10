-- Add purchased_credits table.
--
-- Tracks each Pay with AI3 credit purchase as a discrete row with its own
-- expiry date. Free-tier and one-off allocation credits are NOT stored here —
-- they remain on accounts.upload_limit / accounts.download_limit as before.
--
-- When a user uploads a file the system checks this table first (FIFO by
-- expires_at), consumes from the soonest-expiring row, and only falls back
-- to the legacy limit-based allocation when no active purchased credits exist.
--
-- One row per purchase → independent expiry dates, clear audit trail,
-- accurate FIFO consumption.

CREATE TABLE purchased_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The account that owns these credits (accounts.id, not user publicId).
  account_id TEXT NOT NULL REFERENCES accounts(id),

  -- The payment intent that generated this row. Always set for purchased credits.
  intent_id VARCHAR(255) NOT NULL REFERENCES intents(id),

  -- Immutable snapshot of what was granted. Used for history display and
  -- future refund calculations. Never mutated after insert.
  upload_bytes_original   BIGINT NOT NULL CHECK (upload_bytes_original   >= 0),
  download_bytes_original BIGINT NOT NULL CHECK (download_bytes_original >= 0),

  -- Running balance decremented by the FIFO consumption logic.
  upload_bytes_remaining   BIGINT NOT NULL CHECK (upload_bytes_remaining   >= 0),
  download_bytes_remaining BIGINT NOT NULL CHECK (download_bytes_remaining >= 0),

  -- When the credits in this purchase were paid for. Secondary FIFO sort key.
  purchased_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Every purchased credit row has a hard expiry. NULL is not allowed here —
  -- use accounts.upload_limit for non-expiring allocations.
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Set to TRUE by the expiry background job once expires_at has passed.
  expired BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT upload_remaining_lte_original   CHECK (upload_bytes_remaining   <= upload_bytes_original),
  CONSTRAINT download_remaining_lte_original CHECK (download_bytes_remaining <= download_bytes_original)
);

-- Primary query: active credits for an account ordered soonest-expiry first.
-- Covers: FIFO consumption, remaining balance aggregation, expiry warnings.
CREATE INDEX idx_purchased_credits_account_expiry
  ON purchased_credits (account_id, expired, expires_at ASC);

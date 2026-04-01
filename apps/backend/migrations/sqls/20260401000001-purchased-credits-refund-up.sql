-- Add refund tracking columns to purchased_credits.
--
-- refunded:     TRUE once an admin has marked this batch as manually refunded
--               via POST /credits/batches/:id/refund. Zeroing out the
--               remaining bytes happens in the same operation so the user
--               cannot continue using credits they have been refunded for.
--
-- refunded_at:  Timestamp of the refund action for the audit trail.

ALTER TABLE purchased_credits
  ADD COLUMN refunded    BOOLEAN                     NOT NULL DEFAULT FALSE,
  ADD COLUMN refunded_at TIMESTAMP WITH TIME ZONE;

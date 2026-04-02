-- Add refund tracking to purchased_credits.
--
-- refunded_at:  Timestamp of when an admin marked this batch as manually
--               refunded via POST /credits/batches/:id/refund. NULL means
--               not refunded. The presence of a timestamp is the canonical
--               source of truth — no separate boolean needed.
--               Remaining bytes are zeroed out in the same operation so the
--               user cannot continue using credits they have been refunded for.

ALTER TABLE purchased_credits
  ADD COLUMN refunded_at TIMESTAMP WITH TIME ZONE;

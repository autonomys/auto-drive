-- Add refund transaction hash tracking to purchased_credits.
--
-- refund_tx_hash: On-chain transaction hash of the AI3 refund transfer the
--                 admin executed before marking the batch as refunded.
--                 Mandatory for every new refund — the refund endpoints
--                 reject requests without it. Multiple batches refunded in
--                 a single on-chain transaction share the same hash.
--                 NULL only on rows refunded before this column existed.

ALTER TABLE purchased_credits
  ADD COLUMN refund_tx_hash VARCHAR(255);

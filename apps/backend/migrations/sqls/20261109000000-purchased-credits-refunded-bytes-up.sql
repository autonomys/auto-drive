-- The upload bytes a refund took back: what the batch had left when it was
-- refunded. A refund zeroes upload_bytes_remaining, so without this a batch's
-- consumption ledger cannot be reconciled with its balance (#891), nor its
-- refund shown in a usage report (#893). NULL on batches refunded before this
-- shipped, whose remaining bytes were not recorded, and on unrefunded batches.
ALTER TABLE public.purchased_credits
  ADD COLUMN refunded_upload_bytes bigint CHECK (refunded_upload_bytes >= 0);

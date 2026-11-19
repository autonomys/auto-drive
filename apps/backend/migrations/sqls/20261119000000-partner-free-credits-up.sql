-- Free upload credits for partner accounts. purchased_credits now also holds
-- batches an admin grants for free: one-time grants and a monthly allowance
-- issued per UTC calendar month. They are consumed, expire and are reported
-- like purchased batches, with no intent and so no payment.
ALTER TABLE public.purchased_credits ALTER COLUMN intent_id DROP NOT NULL;
ALTER TABLE public.purchased_credits
  -- Admin publicId, one-time free credits only.
  ADD COLUMN granted_by text,
  -- One-time free credits only.
  ADD COLUMN grant_reason text,
  -- First day of the UTC month, monthly free credits only.
  ADD COLUMN grant_period date;

-- Exactly one source: a purchase (intent), a one-time grant, or a monthly grant.
ALTER TABLE public.purchased_credits ADD CONSTRAINT purchased_credits_one_source
  CHECK (num_nonnulls(intent_id, granted_by, grant_period) = 1);

-- One monthly batch per account and month, however many requests issue it.
CREATE UNIQUE INDEX purchased_credits_account_grant_period_key
  ON public.purchased_credits (account_id, grant_period)
  WHERE grant_period IS NOT NULL;

ALTER TABLE public.accounts
  ADD COLUMN monthly_free_upload_bytes bigint NOT NULL DEFAULT 0
  CHECK (monthly_free_upload_bytes >= 0);

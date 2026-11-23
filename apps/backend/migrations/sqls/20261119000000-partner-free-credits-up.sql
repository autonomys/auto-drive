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
  ADD COLUMN grant_period date,
  -- Monthly free credits only: when a change to the monthly amount ended the
  -- batch early (expires_at is brought forward to the same time) and a batch
  -- for the rest of the month replaced it.
  ADD COLUMN superseded_at timestamptz;

-- Exactly one source: a purchase (intent), a one-time grant, or a monthly grant.
ALTER TABLE public.purchased_credits ADD CONSTRAINT purchased_credits_one_source
  CHECK (num_nonnulls(intent_id, granted_by, grant_period) = 1);

-- One current monthly batch per account and month, however many requests
-- issue it. Batches replaced by a change to the monthly amount stay as history.
CREATE UNIQUE INDEX purchased_credits_account_grant_period_key
  ON public.purchased_credits (account_id, grant_period)
  WHERE grant_period IS NOT NULL AND superseded_at IS NULL;

ALTER TABLE public.accounts
  ADD COLUMN monthly_free_upload_bytes bigint NOT NULL DEFAULT 0
  CHECK (monthly_free_upload_bytes >= 0);

-- Uploads paid with free credits are recorded as such, apart from uploads paid
-- with purchased credits. The CHECK was declared inline on the column, so its
-- name is looked up rather than assumed. The new one is NOT VALID: it allows
-- more than the old one, which every existing row already passed, and
-- validating it would scan all of interactions.
DO $$
DECLARE
  name text;
BEGIN
  FOR name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.interactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.interactions DROP CONSTRAINT %I', name);
  END LOOP;
END $$;
ALTER TABLE public.interactions ADD CONSTRAINT interactions_source_check
  CHECK (source IN ('free_tier', 'purchased', 'free_credits')) NOT VALID;

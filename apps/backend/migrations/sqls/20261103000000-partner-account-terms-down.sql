DROP TABLE IF EXISTS public.account_terms_changes;

ALTER TABLE public.accounts
  DROP COLUMN IF EXISTS credit_expiry_days,
  DROP COLUMN IF EXISTS max_purchased_bytes;

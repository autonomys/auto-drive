-- Destroys every free credit batch and the record of which uploads drew on
-- them: those uploads are then reported as unattributed.
DELETE FROM public.interaction_credit_consumption
WHERE purchased_credit_id IN (
  SELECT id FROM public.purchased_credits WHERE intent_id IS NULL
);
DELETE FROM public.purchased_credits WHERE intent_id IS NULL;

DROP INDEX IF EXISTS public.purchased_credits_account_grant_period_key;
ALTER TABLE public.purchased_credits
  DROP CONSTRAINT IF EXISTS purchased_credits_one_source,
  DROP COLUMN IF EXISTS granted_by,
  DROP COLUMN IF EXISTS grant_reason,
  DROP COLUMN IF EXISTS grant_period;
ALTER TABLE public.purchased_credits ALTER COLUMN intent_id SET NOT NULL;

ALTER TABLE public.accounts DROP COLUMN IF EXISTS monthly_free_upload_bytes;

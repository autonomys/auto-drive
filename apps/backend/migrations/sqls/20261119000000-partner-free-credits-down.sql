-- Destroys every free credit batch and the record of which uploads drew on
-- them: those uploads are then reported as unattributed purchased uploads.
DELETE FROM public.interaction_credit_consumption
WHERE purchased_credit_id IN (
  SELECT id FROM public.purchased_credits WHERE intent_id IS NULL
);
DELETE FROM public.purchased_credits WHERE intent_id IS NULL;

UPDATE public.interactions SET source = 'purchased'
WHERE source = 'free_credits';
ALTER TABLE public.interactions DROP CONSTRAINT IF EXISTS interactions_source_check;
ALTER TABLE public.interactions ADD CONSTRAINT interactions_source_check
  CHECK (source IN ('free_tier', 'purchased')) NOT VALID;

DROP INDEX IF EXISTS public.purchased_credits_account_grant_period_key;
ALTER TABLE public.purchased_credits
  DROP CONSTRAINT IF EXISTS purchased_credits_one_source,
  DROP COLUMN IF EXISTS granted_by,
  DROP COLUMN IF EXISTS grant_reason,
  DROP COLUMN IF EXISTS grant_period,
  DROP COLUMN IF EXISTS superseded_at;
ALTER TABLE public.purchased_credits ALTER COLUMN intent_id SET NOT NULL;

ALTER TABLE public.accounts DROP COLUMN IF EXISTS monthly_free_upload_bytes;

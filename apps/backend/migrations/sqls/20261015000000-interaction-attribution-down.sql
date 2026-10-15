DROP TABLE IF EXISTS public.interaction_credit_consumption;
ALTER TABLE public.interactions DROP COLUMN IF EXISTS api_key_id;
ALTER TABLE public.interactions DROP CONSTRAINT IF EXISTS interactions_pkey;

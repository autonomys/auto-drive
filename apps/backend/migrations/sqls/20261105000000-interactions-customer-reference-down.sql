DROP INDEX IF EXISTS public.interactions_customer_reference_idx;

ALTER TABLE public.interactions
  DROP COLUMN IF EXISTS customer_reference;

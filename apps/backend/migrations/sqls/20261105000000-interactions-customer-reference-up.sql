-- Optional customer reference on upload interactions (#892)
-- Allows callers to attach an opaque customer reference for reconciliation and reporting.

ALTER TABLE public.interactions
  ADD COLUMN customer_reference text NULL;

CREATE INDEX interactions_customer_reference_idx
  ON public.interactions (customer_reference)
  WHERE customer_reference IS NOT NULL;

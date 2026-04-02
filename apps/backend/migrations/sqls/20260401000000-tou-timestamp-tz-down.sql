ALTER TABLE public.user_tou_acceptance
  ALTER COLUMN accepted_at TYPE TIMESTAMP;

ALTER TABLE public.tou_versions
  ALTER COLUMN effective_date TYPE TIMESTAMP,
  ALTER COLUMN created_at TYPE TIMESTAMP,
  ALTER COLUMN updated_at TYPE TIMESTAMP;

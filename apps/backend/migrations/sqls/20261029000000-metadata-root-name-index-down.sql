SET LOCAL lock_timeout = '5s';
ALTER TABLE public.metadata ALTER COLUMN created_at DROP NOT NULL;

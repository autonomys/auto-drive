-- The file tables sort created_at with plain DESC, which puts NULLs first, so
-- a root with no created_at would sit at the top of every feed.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.metadata ALTER COLUMN created_at SET NOT NULL;

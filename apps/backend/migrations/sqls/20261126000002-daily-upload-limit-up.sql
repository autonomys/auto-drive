-- The most a partner account may upload in a rolling 24 hours, set by the
-- partner's organisation admins. NULL until they set it: the account's end
-- users can't upload until then, and everyone else uploads as before.
-- daily_upload_limit_off records that the admins switched it off, which they
-- must acknowledge. Neither default rewrites the table.
ALTER TABLE public.accounts
  ADD COLUMN daily_upload_limit_bytes bigint
  CHECK (daily_upload_limit_bytes >= 0);
ALTER TABLE public.accounts
  ADD COLUMN daily_upload_limit_off boolean NOT NULL DEFAULT false;

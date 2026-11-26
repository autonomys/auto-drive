-- The most any one of a partner's end users may upload in total, set by the
-- partner's organisation admins. Each end user's own quota, held by the auth
-- service, can only be lower. 0 until they set it, so no end user uploads
-- before then. A constant default does not rewrite the table.
ALTER TABLE public.accounts
  ADD COLUMN max_end_user_quota_bytes bigint NOT NULL DEFAULT 0
  CHECK (max_end_user_quota_bytes >= 0);

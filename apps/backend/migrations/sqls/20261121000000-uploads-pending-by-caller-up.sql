-- Before a part is stored, the caller's unfinished bytes are read
-- (uploadsRepository.getUnfinishedBytes). uploads.uploads had only its primary
-- key, so that read scanned every upload row of every caller. Partial, because
-- only pending uploads are read this way.
--
-- Not CONCURRENTLY, for the reason given in 20260826000000-blockstore-cid-index:
-- the build blocks writes to uploads.uploads while it runs. It waits at most
-- 5 s for its lock; if that times out, re-run the migration.
SET LOCAL lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS uploads_pending_by_caller_idx
  ON uploads.uploads (oauth_provider, oauth_user_id)
  WHERE status = 'pending';

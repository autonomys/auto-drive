-- Data fix: un-expire depleted credit batches.
--
-- The credit expiry job used to mark every row past expires_at as
-- expired = TRUE, including rows whose upload credits had already been
-- fully consumed (0 upload bytes remaining). Those rows then showed up in
-- the admin panel as "expired, awaiting refund" even though nothing was
-- forfeited and no refund is owed.
--
-- Depletion is defined on upload bytes only: download bytes are not
-- allocated, consumed or enforced anywhere in the app.
--
-- Refunded rows are excluded: markAsRefunded zeros the remaining bytes, so
-- a refunded row with expired = TRUE was genuinely expired (with bytes
-- remaining) before the admin refunded it.

UPDATE purchased_credits
SET expired    = FALSE,
    updated_at = NOW()
WHERE expired = TRUE
  AND upload_bytes_remaining = 0
  AND refunded_at IS NULL;

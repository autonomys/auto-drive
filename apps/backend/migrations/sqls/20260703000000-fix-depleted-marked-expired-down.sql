-- Restore the (incorrect) pre-fix state: past-expiry depleted rows were
-- flagged expired. Only rows past their expires_at are re-flagged, matching
-- what the old expiry job would have done.

UPDATE purchased_credits
SET expired    = TRUE,
    updated_at = NOW()
WHERE expired = FALSE
  AND expires_at <= NOW()
  AND upload_bytes_remaining = 0
  AND download_bytes_remaining = 0
  AND refunded_at IS NULL;

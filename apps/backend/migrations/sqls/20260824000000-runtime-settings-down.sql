-- Destructive, and shared: `runtime_settings` is deliberately generic, so by the
-- time this is rolled back it may hold keys belonging to features that arrived
-- after it. Dropping the table would take those with it.
--
-- So this removes only the keys this migration introduced, and drops the tables
-- only if nothing else has claimed them. Any later feature that adds a key here
-- must move the table's creation into its own migration first, or accept that a
-- rollback of THIS migration leaves its table in place with its rows intact.
--
-- Note what is lost either way: the manual USDC kill switch reverts to the
-- USDC_PAYMENTS_ENABLED environment default, so an admin's "off" is NOT
-- preserved. Check `GET /payments/usdc/status` before rolling back, and set the
-- environment variable to match.
DELETE FROM runtime_settings WHERE key LIKE 'payments.usdc.%';
DELETE FROM runtime_settings_audit WHERE key LIKE 'payments.usdc.%';

DROP TABLE IF EXISTS runtime_settings_audit;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM runtime_settings) THEN
    DROP TABLE runtime_settings;
  ELSE
    RAISE NOTICE
      'runtime_settings still holds rows for other features; keeping the table';
  END IF;
END $$;

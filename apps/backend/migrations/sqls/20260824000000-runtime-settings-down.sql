-- Destructive: drops the manual USDC kill switch along with the table. A
-- deployment rolled back to before this migration falls back to the
-- USDC_PAYMENTS_ENABLED environment default, so an admin's "off" is NOT
-- preserved — check the current value before rolling back.
DROP TABLE IF EXISTS runtime_settings;

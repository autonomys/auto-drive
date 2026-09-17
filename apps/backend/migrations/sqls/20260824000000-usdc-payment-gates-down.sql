-- Both tables belong to this feature alone, so the rollback is unambiguous —
-- unlike a shared settings table, which would take later features' state with it.
--
-- Note what is lost: the kill switch reverts to the USDC_PAYMENTS_ENABLED
-- environment default, so an admin's "off" is NOT preserved. Check
-- GET /payments/usdc/status before rolling back, and set the variable to match.
DROP TABLE IF EXISTS usdc_gate_readings;
DROP TABLE IF EXISTS usdc_payment_switch;

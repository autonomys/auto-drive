-- Runtime settings: operational state that has to change without a redeploy.
--
-- The existing feature flags (config.featureFlags.flags) are read from the
-- environment, so changing one means a deploy. That disqualifies them for a kill
-- switch: the whole value of the switch is that it takes effect during the
-- incident that made someone reach for it.
--
-- Generic (key -> jsonb) rather than a purpose-built payments table, because the
-- next thing that needs a live toggle should not need a migration. Keys are
-- dotted namespaces; the two this table is created for are:
--
--   payments.usdc.manual_gate  {"enabled": bool}
--                              Written by an admin, through
--                              POST /payments/usdc/{enable,disable}. Latching:
--                              no automatic process ever writes this key, which
--                              is what makes "only an admin reopens it" true by
--                              construction rather than by convention.
--
--   payments.usdc.treasury     {"balanceBaseUnits": "...", "paused": bool,
--                               "addresses": [...]}
--                              Written by the treasury balance poller — one
--                              process, every USDC_TREASURY_BALANCE_CHECK_
--                              INTERVAL_MS. Persisted rather than cached in
--                              memory because the process that POLLS (the
--                              payment worker) is never the process that QUOTES
--                              (the frontend API replicas): an in-memory gate
--                              would read "unknown" in every replica that
--                              matters and fail closed forever.
--
-- `paused` is stored rather than derived from the balance on read, because the
-- resume threshold makes the gate hysteretic: a balance between resume and pause
-- keeps whatever the gate already was, which is not a function of the balance
-- alone. The poller is the single writer and therefore the only thing that can
-- see the previous state.
CREATE TABLE IF NOT EXISTS runtime_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  -- The admin's public id for a human flip, NULL for a machine write. A kill
  -- switch with no audit trail is half a control, and the NULL is not a missing
  -- value — it is the record that no person was involved.
  updated_by text,
  -- Set from the database's clock on every write, and compared against the
  -- database's clock on every read (the repository returns an age computed in
  -- SQL). The writer and the readers are different hosts, so measuring the
  -- staleness of the money path across two NTP-dependent clocks is not a
  -- comparison worth making.
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

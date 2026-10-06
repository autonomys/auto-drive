-- State the USDC payment path is gated on, and which has to change while the
-- system is running.
--
-- Two tables, because there are two writers and keeping them apart is the whole
-- point: a person flips the switch, and the payment worker records what it
-- observed. Nothing automatic can reach the switch, so "only an admin reopens
-- it" is true by construction rather than by convention.
--
-- The existing feature flags (config.featureFlags.flags) are read from the
-- environment, so changing one means a deploy — which disqualifies them for a
-- kill switch, whose entire value is taking effect during the incident that made
-- someone reach for it.

-- The kill switch, as an append-only log: the newest row IS the current value.
--
-- One table rather than a setting plus an audit trail, because for a switch the
-- history and the value are the same fact recorded twice. `updated_by` on a
-- mutable row only ever answers "who has it set now"; the question after an
-- incident is "who turned it off on Tuesday, and when did it come back", and
-- that answer must not be overwritten by the next flip.
--
-- No rows at all means nobody has ever flipped it, and the value is then the
-- USDC_PAYMENTS_ENABLED boot default. Deliberately not seeded: every API replica
-- would race to write it, and a "boot default" that stops mattering after the
-- first boot is a variable nobody can reason about.
CREATE TABLE IF NOT EXISTS usdc_payment_switch (
  id bigserial PRIMARY KEY,
  enabled boolean NOT NULL,
  -- Always a person. The only writer is POST /payments/usdc/{enable,disable},
  -- which is admin-only, so this is NOT NULL — a flip with nobody behind it is
  -- not a thing that should be representable.
  set_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- What the payment worker last observed: the treasury's un-converted USDC, and
-- whether a rate can be established. Exactly one row.
--
-- Persisted rather than held in memory because the process that OBSERVES is never
-- the process that QUOTES: paymentManager.start() (and the gates job beside it)
-- runs in one worker, while createIntent runs in every frontend API replica. An
-- in-memory gate would read "unknown" in every process that matters, fail closed,
-- and USDC would never sell in the topology production actually runs.
--
-- Typed columns rather than a JSON blob, and that is a correctness choice as much
-- as a clarity one: `paused` is what closes the money gate, and a JSON document
-- missing that field reads as "not paused" under any truthiness test — i.e. it
-- opens the path. A boolean column plus the CHECK constraints below make a
-- half-written or hand-edited reading impossible instead of merely unlikely.
CREATE TABLE IF NOT EXISTS usdc_gate_readings (
  -- Single-row table: the constraint is the schema saying so.
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Sum over `treasury_addresses` at `treasury_checked_at`. numeric(78,0) to
  -- match the bigint base-unit convention used across intents.
  treasury_balance_base_units numeric(78,0),
  -- The gate the worker DERIVED, not a re-derivable function of the balance
  -- above: with a resume threshold the rule is hysteretic, so a balance between
  -- the two thresholds keeps whatever the gate already was. Only the single
  -- writer can see the previous state, so only it can decide this.
  treasury_paused boolean,
  -- What was summed. Recorded because "paused at 2,014" means something
  -- different if it was counting two addresses than if it was counting one.
  treasury_addresses text[],
  -- When the reading was taken, from the DATABASE's clock — and compared against
  -- the database's clock on every read (the repository returns the age in SQL).
  -- The writer and the readers are different hosts, and this age decides whether
  -- the money path is open, so it is not a comparison worth making across two
  -- NTP-dependent clocks.
  --
  -- A FAILED poll deliberately writes nothing, so this timestamp going stale IS
  -- the outage signal. Had a failure refreshed it, "balance unknown" — the
  -- fail-closed state — would be unreachable and the rule would be dead code.
  treasury_checked_at timestamptz,

  -- The same, for the price oracle. Written on failure as well as on success:
  -- a refusal IS the observation here (the oracle's guards failing closed is
  -- exactly what this gate needs to know), and `oracle_reason` is what the
  -- dashboard shows.
  oracle_healthy boolean,
  -- OracleUnavailableReason when unhealthy; NULL when the read succeeded. Text
  -- rather than an enum type, so a new reason is a code change and not a
  -- migration — the same choice intent_mispayments.reason makes.
  oracle_reason text,
  oracle_serving_stale boolean,
  oracle_usd_per_ai3 numeric(78,0),
  -- The swap window behind the rate: sample counts, volumes, pool depth, span.
  -- jsonb precisely BECAUSE nothing branches on it — it is rendered on the admin
  -- card and nowhere else, so it needs no shape guarantee, and eight display-only
  -- numbers do not need eight columns.
  oracle_window jsonb,
  oracle_checked_at timestamptz,

  -- A reading is present or absent, never half-written. Without these, a
  -- partially hand-edited row during an incident could leave `treasury_paused`
  -- NULL beside a fresh timestamp, and every reader would have to decide what
  -- that means — on the path that decides whether to take someone's money.
  CONSTRAINT treasury_reading_whole CHECK (
    (
      treasury_checked_at IS NULL
      AND treasury_paused IS NULL
      AND treasury_balance_base_units IS NULL
    )
    OR (
      treasury_checked_at IS NOT NULL
      AND treasury_paused IS NOT NULL
      AND treasury_balance_base_units IS NOT NULL
    )
  ),
  CONSTRAINT oracle_reading_whole CHECK (
    (oracle_checked_at IS NULL AND oracle_healthy IS NULL)
    OR (oracle_checked_at IS NOT NULL AND oracle_healthy IS NOT NULL)
  )
);

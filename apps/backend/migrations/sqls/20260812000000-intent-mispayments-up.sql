-- Record on-chain payments that were refused, so an irreversible transfer is
-- never left with only a log line pointing at it.
--
-- Both receivers accept any intent id from anyone — payIntent(bytes32) on Auto
-- EVM, payIntentWithToken(bytes32, uint256) on Ethereum — so a payment can name
-- an intent that does not exist, or one denominated in the other asset.
-- markIntentAsConfirmed refuses both, which is correct: confirming a mispayment
-- strands the intent in the polling loop AND makes the idempotency guard discard
-- the user's real payment when it arrives. But refusing resolves nothing on
-- chain. The money has moved; the only open question is whose it is, and that
-- question needs a row.
--
-- No foreign key to intents on purpose. The unknown-intent case has no row to
-- point at, and it is exactly the case with the least other evidence attached.

CREATE TABLE IF NOT EXISTS intent_mispayments (
  id bigserial PRIMARY KEY,
  -- The id named by the on-chain event, which may match no intent.
  intent_id text NOT NULL,
  -- IntentMispaymentReason, whose values live in @auto-drive/models rather than
  -- being enumerated here. Text rather than an enum type precisely so a new reason
  -- is a code change and not a migration.
  --
  -- Also the field that says whether a row is a work item. Most values mean a
  -- payment we refused and that needs resolving; 'amount_off_quote' means one we
  -- accepted and credited, on file only because nothing else records that the
  -- amount paid differed from the amount quoted.
  reason text NOT NULL,
  -- What the named intent was denominated in; NULL when there is no such intent.
  expected_payment_method text,
  -- Whichever the watcher reported. Exactly one is set, and which one is itself
  -- the evidence: an AI3 amount against a USDC intent is the asset mismatch.
  -- numeric(78,0) to match the bigint base-unit convention used across intents.
  payment_amount numeric(78,0),
  token_amount numeric(78,0),
  from_address text,
  tx_hash text,
  -- Position of the payment event within its transaction. Part of the dedup key
  -- below, and the only field that tells two payments sharing a hash apart.
  log_index integer,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Stated separately as well as in the CREATE above, so this migration converges
-- on a database that applied an earlier version of it: CREATE TABLE IF NOT
-- EXISTS no-ops on an existing table and would leave the column behind.
ALTER TABLE intent_mispayments
  ADD COLUMN IF NOT EXISTS log_index integer;

-- The watcher re-runs: chain reorgs re-emit events, and the startup sweep
-- replays every PENDING intent that has a tx_hash. Recording is therefore
-- idempotent per payment EVENT rather than append-only, or one restart loop
-- would turn a single mispayment into a page of them.
--
-- Keyed on (tx_hash, log_index) rather than (tx_hash, intent_id), because one
-- transaction can carry more than one payment for the same intent. Both
-- receivers are callable from a contract, so a single transaction can emit the
-- payment event twice for one intent id with different values, and
-- watchTransaction calls markIntentAsConfirmed for every log it parses. Under an
-- (tx_hash, intent_id) key the second refusal collapses into the first, and the
-- queue then records one payment — whichever amount won the race — when two
-- arrived. That understates the refund owed, in the one table whose whole
-- purpose is that an irreversible transfer is never left with nothing but a log
-- line pointing at it.
--
-- A log index is unique within a transaction, so intent_id is not needed in the
-- key. A re-emitted event carries the same (hash, index) pair and still
-- de-duplicates; two distinct payments never share one.
--
-- Partial because neither column can participate in the constraint while NULL
-- (NULLs are distinct in a unique index) — stating that in the predicate keeps
-- the index honest about what it enforces, and small. A row missing either is
-- append-only by construction; every watcher path supplies both.
DROP INDEX IF EXISTS intent_mispayments_tx_intent_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS intent_mispayments_tx_log_uniq
  ON intent_mispayments (tx_hash, log_index)
  WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL;

-- The admin listing reads newest-first and nothing else reads this table.
CREATE INDEX IF NOT EXISTS intent_mispayments_created_at_idx
  ON intent_mispayments (created_at DESC);

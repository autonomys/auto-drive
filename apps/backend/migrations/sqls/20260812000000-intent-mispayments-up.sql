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
  -- IntentMispaymentReason: 'unknown_intent' | 'asset_mismatch'. Text rather
  -- than an enum type so a new reason is a code change, not a migration.
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
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- The watcher re-runs: chain reorgs re-emit events, and the startup sweep
-- replays every PENDING intent that has a tx_hash. Recording is therefore
-- idempotent per (transaction, intent) rather than append-only, or one restart
-- loop would turn a single mispayment into a page of them.
--
-- Partial because a NULL tx_hash cannot participate in the constraint anyway
-- (NULLs are distinct in a unique index) — stating that in the predicate keeps
-- the index honest about what it enforces, and small.
CREATE UNIQUE INDEX IF NOT EXISTS intent_mispayments_tx_intent_uniq
  ON intent_mispayments (tx_hash, intent_id)
  WHERE tx_hash IS NOT NULL;

-- The admin listing reads newest-first and nothing else reads this table.
CREATE INDEX IF NOT EXISTS intent_mispayments_created_at_idx
  ON intent_mispayments (created_at DESC);

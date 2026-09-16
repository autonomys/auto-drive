/**
 * What the intent-polling loop should do with each read of `GET /intents/:id`.
 *
 * Pure, and outside the hook, so the decision can be asserted against the code
 * the app actually runs rather than against a copy of it in a test file.
 *
 * The subtle case is HTTP 410. The backend returns it from `isIntentExpired`,
 * which for a PENDING row with no recorded `tx_hash` is nothing more than
 * `expires_at < now`. That is NOT the state that decides whether credits are
 * granted: `markIntentAsConfirmed` refuses on the status COLUMN being EXPIRED,
 * and the only writer of that column is `cleanupExpiredIntents`, on
 * CREDIT_EXPIRY_CHECK_INTERVAL — one hour by default. A USDC payment reaches
 * six confirmations in about seventy seconds, so a payment sent just after the
 * lock lapsed is normally credited in full. It does not even need its hash to
 * have been registered for that: the receiver's event subscription identifies
 * the intent from the deposit event itself.
 *
 * So a 410 is a caution, not a verdict — and treating it as terminal is how a
 * successful purchase came to be reported as lost money. It stops the loop only
 * once it has persisted long enough that nothing is coming.
 */

/**
 * Fallback for how long a 410 must persist before the purchase is called
 * expired, used when the caller has no served value.
 *
 * The USDC path does have one: `GET /payments/usdc/target` reports
 * `settleGraceMs`, computed on the backend as four turns of the credit-granting
 * poller (EVM_CHAIN_CHECK_INTERVAL, 30s by default). It is served rather than
 * compiled in for exactly the reason the number below is suspicious in
 * isolation: it is a property of the BACKEND's timing, so a build holding its
 * own copy starts calling credited purchases lost the day an operator changes
 * that interval.
 *
 * Two minutes matches today's default, and the AI3 step — which has no target
 * endpoint to ask — uses it.
 *
 * Measured from the first 410 the loop sees, which is after the client's own
 * confirmation threshold, so the remaining work is the backend's: its watcher
 * writes CONFIRMED off the same receipt, then the poller writes COMPLETED. Past
 * the grace the row is genuinely EXPIRED and the payment, if one arrived, is in
 * `intent_mispayments` for an admin.
 */
export const LOCK_LAPSED_SETTLE_GRACE_MS = 120_000;

export type IntentPollDecision =
  /** Credits granted. Terminal. */
  | { state: 'completed'; shouldContinue: false }
  /** Payment received, credit cap reached. Terminal, needs an admin. */
  | { state: 'over_cap'; shouldContinue: false }
  /** The lock lapsed and stayed lapsed past the grace. Terminal. */
  | { state: 'expired'; shouldContinue: false }
  /** The lock has lapsed, but the payment can still settle. Warn, keep going. */
  | { state: 'lock-lapsed'; shouldContinue: true }
  /** The backend answered and the lock is not lapsed. Clears any caution. */
  | { state: 'live'; shouldContinue: true }
  /** The read failed for an unrelated reason. Says nothing; change nothing. */
  | { state: 'unknown'; shouldContinue: true };

/**
 * Decide from a successful read.
 *
 * A 2xx is itself the information that the lock is not lapsed — `getIntent`
 * would have thrown 410 before returning a status string — which is what makes
 * `live` the state that clears a caution raised earlier.
 */
export const evaluateIntentStatus = (status: string): IntentPollDecision => {
  if (status === 'completed')
    return { state: 'completed', shouldContinue: false };
  if (status === 'over_cap')
    return { state: 'over_cap', shouldContinue: false };
  return { state: 'live', shouldContinue: true };
};

/**
 * Decide from a failed read.
 *
 * Takes the HTTP status rather than the thrown value — null for a failure that
 * carried none — so this stays importable from a unit test. `services/api` is
 * where `ApiError` lives, and reaching it drags in `@autonomys/auto-drive`,
 * which is ESM and unresolvable under this suite's CommonJS transform. The
 * narrowing that produces this argument is one `instanceof` in the caller.
 *
 * `lapsedSince` is when the loop first saw a 410 (null if it has not), and is
 * what turns a repeated caution into a terminal answer. Any other failure — a
 * 500, a dropped connection — is `unknown` rather than `live`, because it
 * carries no statement about the lock and must not clear a caution that does.
 */
export const evaluatePollError = (
  status: number | null,
  {
    lapsedSince,
    now,
    graceMs = LOCK_LAPSED_SETTLE_GRACE_MS,
  }: { lapsedSince: number | null; now: number; graceMs?: number },
): IntentPollDecision => {
  if (status !== 410) return { state: 'unknown', shouldContinue: true };

  if (lapsedSince !== null && now - lapsedSince >= graceMs) {
    return { state: 'expired', shouldContinue: false };
  }

  return { state: 'lock-lapsed', shouldContinue: true };
};

/**
 * The intent-polling decision logic behind useTransactionConfirmation.
 *
 * These import the real module the hook runs — `utils/intentPolling` — rather
 * than a replica of it. The previous version of this file re-declared the
 * decision functions locally, which is why it kept passing while the behaviour
 * it described was wrong: a copy cannot regress.
 *
 * The behaviour under test: the backend answers `GET /intents/:id` with HTTP
 * 410 from `isIntentExpired`, which for a PENDING row with no recorded tx_hash
 * is nothing more than `expires_at < now`. Credits are withheld by a different
 * check — `markIntentAsConfirmed` reading the status COLUMN as EXPIRED, written
 * only by the hourly `cleanupExpiredIntents` — so a payment confirming ~72s
 * after the lock lapsed is normally credited. A 410 is therefore a caution the
 * loop must poll through, and terminal only once it persists past the grace.
 */

import {
  LOCK_LAPSED_SETTLE_GRACE_MS,
  evaluateIntentStatus,
  evaluatePollError,
} from '../../../src/utils/intentPolling';

// ---------------------------------------------------------------------------
// Successful read (2xx)
// ---------------------------------------------------------------------------

describe('evaluateIntentStatus', () => {
  it('is terminal for "completed"', () => {
    expect(evaluateIntentStatus('completed')).toEqual({
      state: 'completed',
      shouldContinue: false,
    });
  });

  it('is terminal for "over_cap"', () => {
    expect(evaluateIntentStatus('over_cap')).toEqual({
      state: 'over_cap',
      shouldContinue: false,
    });
  });

  it.each(['pending', 'confirmed', 'failed'])(
    'keeps polling, and reports the lock live, for "%s"',
    (status) => {
      expect(evaluateIntentStatus(status)).toEqual({
        state: 'live',
        shouldContinue: true,
      });
    },
  );

  it('never reports both completed and over_cap', () => {
    expect(evaluateIntentStatus('over_cap').state).not.toBe('completed');
    expect(evaluateIntentStatus('completed').state).not.toBe('over_cap');
  });
});

// ---------------------------------------------------------------------------
// Failed read — the 410 that used to end the purchase
// ---------------------------------------------------------------------------

describe('evaluatePollError', () => {
  const now = 1_700_000_000_000;

  it('treats the first 410 as a caution and keeps polling', () => {
    expect(evaluatePollError(410, { lapsedSince: null, now })).toEqual({
      state: 'lock-lapsed',
      shouldContinue: true,
    });
  });

  it('keeps polling while the lapse is inside the grace', () => {
    expect(
      evaluatePollError(410, {
        lapsedSince: now - (LOCK_LAPSED_SETTLE_GRACE_MS - 1),
        now,
      }),
    ).toEqual({ state: 'lock-lapsed', shouldContinue: true });
  });

  it('becomes terminal once the lapse reaches the grace', () => {
    expect(
      evaluatePollError(410, {
        lapsedSince: now - LOCK_LAPSED_SETTLE_GRACE_MS,
        now,
      }),
    ).toEqual({ state: 'expired', shouldContinue: false });
  });

  it('stays terminal past the grace', () => {
    expect(
      evaluatePollError(410, {
        lapsedSince: now - LOCK_LAPSED_SETTLE_GRACE_MS * 10,
        now,
      }),
    ).toEqual({ state: 'expired', shouldContinue: false });
  });

  it('honours an explicit grace', () => {
    expect(
      evaluatePollError(410, { lapsedSince: now - 5_000, now, graceMs: 1_000 }),
    ).toEqual({ state: 'expired', shouldContinue: false });
  });

  it.each([500, 502, 401, 404])(
    'keeps polling on %i without touching the caution',
    (status) => {
      expect(evaluatePollError(status, { lapsedSince: null, now })).toEqual({
        state: 'unknown',
        shouldContinue: true,
      });
    },
  );

  it('keeps polling on a failure that carried no status', () => {
    // What the caller passes for anything that is not an ApiError: a network
    // drop, an aborted fetch, a thrown string.
    expect(evaluatePollError(null, { lapsedSince: null, now })).toEqual({
      state: 'unknown',
      shouldContinue: true,
    });
  });

  it('does not expire on a 500 that outlasts the grace', () => {
    // The distinction `unknown` exists for. An unrelated outage says nothing
    // about the lock, so it must not accumulate towards a terminal answer.
    expect(
      evaluatePollError(500, {
        lapsedSince: now - LOCK_LAPSED_SETTLE_GRACE_MS * 10,
        now,
      }),
    ).toEqual({ state: 'unknown', shouldContinue: true });
  });
});

// ---------------------------------------------------------------------------
// The sequence that matters: a late payment being credited
// ---------------------------------------------------------------------------

/**
 * Drive the two decision functions over a sequence of reads, applying the same
 * two lines of bookkeeping the hook does — start the clock on the first 410,
 * clear it on a successful read — and report what the UI would end up showing.
 */
const runPolls = (
  reads: Array<{ atMs: number; ok?: string; status?: number }>,
) => {
  let lapsedSince: number | null = null;
  let lockLapsed = false;
  let expired = false;
  let completed = false;
  let overCap = false;

  for (const read of reads) {
    const decision =
      read.ok !== undefined
        ? evaluateIntentStatus(read.ok)
        : evaluatePollError(read.status ?? null, {
            lapsedSince,
            now: read.atMs,
          });

    if (decision.state === 'lock-lapsed') {
      if (lapsedSince === null) lapsedSince = read.atMs;
      lockLapsed = true;
    } else if (decision.state === 'live') {
      lapsedSince = null;
      lockLapsed = false;
    } else if (decision.state === 'expired') {
      expired = true;
    } else if (decision.state === 'completed') {
      lockLapsed = false;
      completed = true;
    } else if (decision.state === 'over_cap') {
      overCap = true;
    }

    if (!decision.shouldContinue) break;
  }

  return { lockLapsed, expired, completed, overCap };
};

describe('a payment sent after the price lock lapsed', () => {
  it('is credited, and never reported as expired', () => {
    // The regression. The row is PENDING past expires_at when the loop starts,
    // the backend watcher settles it, and the credit-grant poller writes
    // COMPLETED a turn later — all inside the grace.
    expect(
      runPolls([
        { atMs: 0, status: 410 },
        { atMs: 2_000, status: 410 },
        { atMs: 4_000, ok: 'confirmed' },
        { atMs: 6_000, ok: 'completed' },
      ]),
    ).toEqual({
      lockLapsed: false,
      expired: false,
      completed: true,
      overCap: false,
    });
  });

  it('withdraws the caution as soon as one read succeeds', () => {
    expect(
      runPolls([
        { atMs: 0, status: 410 },
        { atMs: 2_000, ok: 'confirmed' },
      ]),
    ).toEqual({
      lockLapsed: false,
      expired: false,
      completed: false,
      overCap: false,
    });
  });

  it('is reported expired only after the grace elapses', () => {
    const before = runPolls([
      { atMs: 0, status: 410 },
      { atMs: LOCK_LAPSED_SETTLE_GRACE_MS - 2_000, status: 410 },
    ]);
    expect(before).toEqual({
      lockLapsed: true,
      expired: false,
      completed: false,
      overCap: false,
    });

    const after = runPolls([
      { atMs: 0, status: 410 },
      { atMs: LOCK_LAPSED_SETTLE_GRACE_MS, status: 410 },
    ]);
    expect(after.expired).toBe(true);
  });

  it('does not restart the grace clock on later 410s', () => {
    // The clock is set once, on the first 410. If each read reset it the loop
    // would never reach a terminal answer.
    expect(
      runPolls([
        { atMs: 0, status: 410 },
        { atMs: 40_000, status: 410 },
        { atMs: 80_000, status: 410 },
        { atMs: LOCK_LAPSED_SETTLE_GRACE_MS, status: 410 },
      ]).expired,
    ).toBe(true);
  });

  it('restarts the grace clock after an intervening success', () => {
    // A 410, a 2xx, then a 410 again is a fresh caution, not a continuation of
    // the first — the backend withdrew the lapse in between.
    expect(
      runPolls([
        { atMs: 0, status: 410 },
        { atMs: 2_000, ok: 'pending' },
        { atMs: 4_000, status: 410 },
        { atMs: LOCK_LAPSED_SETTLE_GRACE_MS, status: 410 },
      ]),
    ).toEqual({
      lockLapsed: true,
      expired: false,
      completed: false,
      overCap: false,
    });
  });

  it('still reports over_cap, which is terminal on its own', () => {
    expect(
      runPolls([
        { atMs: 0, status: 410 },
        { atMs: 2_000, ok: 'over_cap' },
      ]).overCap,
    ).toBe(true);
  });
});

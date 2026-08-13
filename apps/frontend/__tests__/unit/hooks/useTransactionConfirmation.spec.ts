/**
 * Unit tests for the intent-polling decision logic used by
 * useTransactionConfirmation.  The try-branch decision now lives in a real,
 * exported module (hooks/intentPolling) that both the hook and these tests
 * import, so there is a single source of truth to verify — the earlier
 * hook/test mirror is what let a terminal `failed` status go unhandled.  These
 * tests still need no React rendering environment.
 *
 * IMPORTANT: The backend returns HTTP 410 Gone for expired intents instead of
 * an `{ status: 'expired' }` response body.  The `getIntent` call throws an
 * `ApiError(410, …)` before the caller ever sees a status string.  The polling
 * loop detects this via the catch block, not via `intent.status === 'expired'`.
 */

import { evaluateIntentStatus } from 'hooks/intentPolling'

// ---------------------------------------------------------------------------
// Minimal ApiError replica (mirrors apps/frontend/src/services/api.ts) — used
// only by the catch-branch tests below, which exercise thrown-error handling.
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface PollErrorResult {
  expired: boolean
  shouldContinue: boolean
}

/**
 * Mirrors the catch-branch of the `poll` callback: evaluates the thrown error.
 * The backend returns HTTP 410 for expired intents, so this is the only path
 * through which `expired` can become true.
 */
function evaluatePollError(error: unknown): PollErrorResult {
  if (error instanceof ApiError && error.status === 410) {
    return { expired: true, shouldContinue: false }
  }
  return { expired: false, shouldContinue: true }
}

// ---------------------------------------------------------------------------
// Tests — successful response branch (try): the real, shared decision function
// ---------------------------------------------------------------------------

describe('evaluateIntentStatus (try branch)', () => {
  it('marks completed and stops polling for "completed"', () => {
    expect(evaluateIntentStatus('completed')).toEqual({
      completed: true,
      overCap: false,
      failed: false,
      shouldContinue: false,
    })
  })

  it('marks overCap and stops polling for "over_cap"', () => {
    expect(evaluateIntentStatus('over_cap')).toEqual({
      completed: false,
      overCap: true,
      failed: false,
      shouldContinue: false,
    })
  })

  it('marks failed and stops polling for "failed"', () => {
    // Regression guard for #634: the backend marks dust payments FAILED
    // permanently, so the loop must stop — not poll forever.
    expect(evaluateIntentStatus('failed')).toEqual({
      completed: false,
      overCap: false,
      failed: true,
      shouldContinue: false,
    })
  })

  it('continues polling for "pending"', () => {
    expect(evaluateIntentStatus('pending')).toEqual({
      completed: false,
      overCap: false,
      failed: false,
      shouldContinue: true,
    })
  })

  it('continues polling for "confirmed"', () => {
    expect(evaluateIntentStatus('confirmed')).toEqual({
      completed: false,
      overCap: false,
      failed: false,
      shouldContinue: true,
    })
  })

  it('continues polling for an unknown status', () => {
    expect(evaluateIntentStatus('something_new').shouldContinue).toBe(true)
  })

  it('terminal statuses are mutually exclusive', () => {
    expect(evaluateIntentStatus('over_cap').completed).toBe(false)
    expect(evaluateIntentStatus('completed').overCap).toBe(false)
    expect(evaluateIntentStatus('failed').completed).toBe(false)
    expect(evaluateIntentStatus('failed').overCap).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests — error branch (catch — expired intent detection)
// ---------------------------------------------------------------------------

describe('evaluatePollError (catch branch — expired intent detection)', () => {
  it('marks expired and stops polling on ApiError with status 410', () => {
    const error = new ApiError(410, 'Intent has expired')
    const result = evaluatePollError(error)
    expect(result.expired).toBe(true)
    expect(result.shouldContinue).toBe(false)
  })

  it('continues polling on ApiError with non-410 status (e.g. 500)', () => {
    const error = new ApiError(500, 'Internal server error')
    const result = evaluatePollError(error)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(true)
  })

  it('continues polling on generic Error (network failure, etc.)', () => {
    const error = new Error('fetch failed')
    const result = evaluatePollError(error)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(true)
  })

  it('continues polling on non-Error thrown value', () => {
    const result = evaluatePollError('unexpected string')
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(true)
  })
})

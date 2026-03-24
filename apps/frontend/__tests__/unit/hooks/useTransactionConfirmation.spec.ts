/**
 * Unit tests for the intent-polling decision logic extracted from
 * useTransactionConfirmation.  These tests verify the correct terminal-state
 * handling for completed, over_cap, and expired intents without requiring a
 * React rendering environment.
 *
 * IMPORTANT: The backend returns HTTP 410 Gone for expired intents instead of
 * an `{ status: 'expired' }` response body.  The `getIntent` call throws an
 * `ApiError(410, …)` before the caller ever sees a status string.  The polling
 * loop detects this via the catch block, not via `intent.status === 'expired'`.
 */

// ---------------------------------------------------------------------------
// Minimal ApiError replica (mirrors apps/frontend/src/services/api.ts)
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

// ---------------------------------------------------------------------------
// Polling decision logic (mirrors the try/catch in the `poll` callback)
// ---------------------------------------------------------------------------

type IntentStatus = 'pending' | 'confirmed' | 'completed' | 'failed' | 'over_cap'

interface PollResult {
  completed: boolean
  overCap: boolean
  expired: boolean
  shouldContinue: boolean
}

/**
 * Mirrors the try-branch: evaluates the status string returned in the
 * response body when the API call succeeds (HTTP 2xx).
 */
function evaluateIntentStatus(status: IntentStatus): PollResult {
  if (status === 'completed') {
    return { completed: true, overCap: false, expired: false, shouldContinue: false }
  }
  if (status === 'over_cap') {
    return { completed: false, overCap: true, expired: false, shouldContinue: false }
  }
  return { completed: false, overCap: false, expired: false, shouldContinue: true }
}

/**
 * Mirrors the catch-branch: evaluates the thrown error.  The backend returns
 * HTTP 410 for expired intents, so this is the only path through which
 * `expired` can become true.
 */
function evaluatePollError(error: unknown): PollResult {
  if (error instanceof ApiError && error.status === 410) {
    return { completed: false, overCap: false, expired: true, shouldContinue: false }
  }
  return { completed: false, overCap: false, expired: false, shouldContinue: true }
}

// ---------------------------------------------------------------------------
// Tests — successful response branch (try)
// ---------------------------------------------------------------------------

describe('evaluateIntentStatus (try branch)', () => {
  it('marks completed and stops polling for "completed"', () => {
    const result = evaluateIntentStatus('completed')
    expect(result.completed).toBe(true)
    expect(result.overCap).toBe(false)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(false)
  })

  it('marks overCap and stops polling for "over_cap"', () => {
    const result = evaluateIntentStatus('over_cap')
    expect(result.completed).toBe(false)
    expect(result.overCap).toBe(true)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(false)
  })

  it('continues polling for "pending"', () => {
    const result = evaluateIntentStatus('pending')
    expect(result).toEqual({ completed: false, overCap: false, expired: false, shouldContinue: true })
  })

  it('continues polling for "confirmed"', () => {
    const result = evaluateIntentStatus('confirmed')
    expect(result).toEqual({ completed: false, overCap: false, expired: false, shouldContinue: true })
  })

  it('continues polling for "failed"', () => {
    const result = evaluateIntentStatus('failed')
    expect(result).toEqual({ completed: false, overCap: false, expired: false, shouldContinue: true })
  })

  it('over_cap and completed are mutually exclusive', () => {
    expect(evaluateIntentStatus('over_cap').completed).toBe(false)
    expect(evaluateIntentStatus('completed').overCap).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests — error branch (catch)
// ---------------------------------------------------------------------------

describe('evaluatePollError (catch branch — expired intent detection)', () => {
  it('marks expired and stops polling on ApiError with status 410', () => {
    const error = new ApiError(410, 'Intent has expired')
    const result = evaluatePollError(error)
    expect(result.expired).toBe(true)
    expect(result.completed).toBe(false)
    expect(result.overCap).toBe(false)
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

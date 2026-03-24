/**
 * Unit tests for the intent-polling decision logic extracted from
 * useTransactionConfirmation.  These tests verify the correct terminal-state
 * handling for completed and over_cap intents without requiring a React
 * rendering environment.
 */

// ---------------------------------------------------------------------------
// Polling decision logic (extracted inline to test independently)
// ---------------------------------------------------------------------------

type IntentStatus = 'pending' | 'confirmed' | 'completed' | 'failed' | 'expired' | 'over_cap'

interface PollResult {
  /** True if the backend has successfully applied credits. */
  completed: boolean
  /** True if the intent hit the per-user cap and credits were NOT applied. */
  overCap: boolean
  /** True if the intent has expired and credits will never be applied. */
  expired: boolean
  /** True if polling should continue on the next iteration. */
  shouldContinue: boolean
}

/**
 * Pure function mirroring the decision branch inside the `poll` callback of
 * useTransactionConfirmation.  This is what we test here.
 */
function evaluateIntentStatus(status: IntentStatus): PollResult {
  if (status === 'completed') {
    return { completed: true, overCap: false, expired: false, shouldContinue: false }
  }
  if (status === 'over_cap') {
    return { completed: false, overCap: true, expired: false, shouldContinue: false }
  }
  if (status === 'expired') {
    return { completed: false, overCap: false, expired: true, shouldContinue: false }
  }
  // Any other status (pending, confirmed, failed) → keep polling
  return { completed: false, overCap: false, expired: false, shouldContinue: true }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateIntentStatus (useTransactionConfirmation polling logic)', () => {
  it('marks completed=true and stops polling when status is "completed"', () => {
    const result = evaluateIntentStatus('completed')
    expect(result.completed).toBe(true)
    expect(result.overCap).toBe(false)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(false)
  })

  it('marks overCap=true and stops polling when status is "over_cap"', () => {
    const result = evaluateIntentStatus('over_cap')
    expect(result.completed).toBe(false)
    expect(result.overCap).toBe(true)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(false)
  })

  it('marks expired=true and stops polling when status is "expired"', () => {
    const result = evaluateIntentStatus('expired')
    expect(result.completed).toBe(false)
    expect(result.overCap).toBe(false)
    expect(result.expired).toBe(true)
    expect(result.shouldContinue).toBe(false)
  })

  it('continues polling when status is "pending"', () => {
    const result = evaluateIntentStatus('pending')
    expect(result.completed).toBe(false)
    expect(result.overCap).toBe(false)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(true)
  })

  it('continues polling when status is "confirmed"', () => {
    const result = evaluateIntentStatus('confirmed')
    expect(result.completed).toBe(false)
    expect(result.overCap).toBe(false)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(true)
  })

  it('continues polling when status is "failed" (surface through continued polling)', () => {
    const result = evaluateIntentStatus('failed')
    expect(result.completed).toBe(false)
    expect(result.overCap).toBe(false)
    expect(result.expired).toBe(false)
    expect(result.shouldContinue).toBe(true)
  })

  it('over_cap is NOT the same as completed — they are mutually exclusive', () => {
    const overCapResult = evaluateIntentStatus('over_cap')
    const completedResult = evaluateIntentStatus('completed')
    expect(overCapResult.completed).toBe(false)
    expect(completedResult.overCap).toBe(false)
  })
})

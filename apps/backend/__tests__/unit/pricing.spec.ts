import { describe, it, expect } from '@jest/globals'
import { applyMarginPercent } from '../../src/shared/utils/pricing.js'

describe('applyMarginPercent', () => {
  it('adds a whole-percent margin (USDC 6-dp amounts)', () => {
    // $1.00 -> $1.05, $10.00 -> $10.50
    expect(applyMarginPercent(1_000_000n, 5)).toBe(1_050_000n)
    expect(applyMarginPercent(10_000_000n, 5)).toBe(10_500_000n)
  })

  it('supports fractional percents', () => {
    expect(applyMarginPercent(1_000_000n, 2.5)).toBe(1_025_000n)
  })

  it('rounds up so it never undercharges', () => {
    // 3 * 10500 / 10000 = 3.15 -> 4
    expect(applyMarginPercent(3n, 5)).toBe(4n)
  })

  it('is a no-op at zero percent', () => {
    expect(applyMarginPercent(1_000_000n, 0)).toBe(1_000_000n)
  })

  it('returns zero for a zero amount', () => {
    expect(applyMarginPercent(0n, 5)).toBe(0n)
  })

  it('throws on a negative, NaN, or infinite margin', () => {
    expect(() => applyMarginPercent(1_000_000n, -1)).toThrow()
    expect(() => applyMarginPercent(1_000_000n, NaN)).toThrow()
    expect(() => applyMarginPercent(1_000_000n, Infinity)).toThrow()
  })

  it('throws on a negative amount', () => {
    expect(() => applyMarginPercent(-1n, 5)).toThrow()
  })
})

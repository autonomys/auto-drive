import { describe, it, expect } from '@jest/globals'
import {
  ai3ShannonsToUsdcBaseUnits,
  applyMarginPercent,
} from '../../src/shared/utils/pricing.js'

describe('ai3ShannonsToUsdcBaseUnits', () => {
  const ONE_AI3 = 10n ** 18n
  // 0.0064 USD/AI3, scaled by USD_RATE_SCALE (1e18).
  const RATE = 6_400_000_000_000_000n

  it('converts whole AI3 amounts to USDC base units', () => {
    // 1000 AI3 * $0.0064 = $6.40 -> 6_400_000 USDC base units.
    expect(ai3ShannonsToUsdcBaseUnits(1000n * ONE_AI3, RATE)).toBe(6_400_000n)
    // 1 AI3 * $0.0064 = $0.0064 -> 6_400 base units.
    expect(ai3ShannonsToUsdcBaseUnits(ONE_AI3, RATE)).toBe(6_400n)
  })

  it('bridges the 18-decimal and 6-decimal domains', () => {
    // At $1.00/AI3 exactly, 1 AI3 must be 1_000_000 USDC base units — an error
    // in the decimal exponent shows up here as a factor of 1e12.
    expect(ai3ShannonsToUsdcBaseUnits(ONE_AI3, 10n ** 18n)).toBe(1_000_000n)
  })

  it('rounds up so a conversion is never valued short', () => {
    // One shannon at $0.0064 is far below a USDC base unit, but not free.
    expect(ai3ShannonsToUsdcBaseUnits(1n, RATE)).toBe(1n)
  })

  it('returns zero for a zero amount', () => {
    expect(ai3ShannonsToUsdcBaseUnits(0n, RATE)).toBe(0n)
  })

  it('throws on negative inputs', () => {
    expect(() => ai3ShannonsToUsdcBaseUnits(-1n, RATE)).toThrow()
    expect(() => ai3ShannonsToUsdcBaseUnits(ONE_AI3, -1n)).toThrow()
  })
})

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

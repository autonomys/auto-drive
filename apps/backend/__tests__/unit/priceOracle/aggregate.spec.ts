import { describe, it, expect } from '@jest/globals'
import { USD_RATE_SCALE } from '@auto-drive/models'
import {
  parseDecimalToScaledBigint,
  median,
  isWithinBounds,
  isQuoteFresh,
} from '../../../src/infrastructure/services/priceOracle/aggregate.js'

describe('priceOracle/aggregate', () => {
  describe('parseDecimalToScaledBigint', () => {
    it('scales integers', () => {
      expect(parseDecimalToScaledBigint('1')).toBe(USD_RATE_SCALE)
      expect(parseDecimalToScaledBigint('100')).toBe(100n * USD_RATE_SCALE)
    })

    it('scales an AI3-range decimal exactly', () => {
      // 0.00639777 USD/AI3 -> 6_397_770_000_000_000 (scaled 1e18)
      expect(parseDecimalToScaledBigint('0.00639777')).toBe(
        6_397_770_000_000_000n,
      )
    })

    it('keeps full precision above the float-safe integer range', () => {
      // 0.05 * 1e18 = 5e16 > 2^53; string scaling stays exact
      expect(parseDecimalToScaledBigint('0.05')).toBe(50_000_000_000_000_000n)
    })

    it('truncates fractional digits beyond the scale', () => {
      const nineteenDecimals = '0.' + '1'.repeat(19) // 19 dp; scale is 18
      expect(parseDecimalToScaledBigint(nineteenDecimals)).toBe(
        BigInt('1'.repeat(18)),
      )
    })

    it('rejects exponential notation, signs, and non-decimals', () => {
      expect(() => parseDecimalToScaledBigint('1e-3')).toThrow()
      expect(() => parseDecimalToScaledBigint('-1')).toThrow()
      expect(() => parseDecimalToScaledBigint('')).toThrow()
      expect(() => parseDecimalToScaledBigint('abc')).toThrow()
    })
  })

  describe('median', () => {
    it('returns the middle value for an odd count', () => {
      expect(median([3n, 1n, 2n])).toBe(2n)
    })

    it('returns the integer mean of the two middles for an even count', () => {
      expect(median([1n, 2n, 3n, 4n])).toBe(2n) // (2 + 3) / 2 = 2 (floor)
      expect(median([10n, 20n])).toBe(15n)
    })

    it('returns the single value for one element', () => {
      expect(median([42n])).toBe(42n)
    })

    it('does not mutate the input', () => {
      const input = [3n, 1n, 2n]
      median(input)
      expect(input).toEqual([3n, 1n, 2n])
    })

    it('throws on an empty list', () => {
      expect(() => median([])).toThrow()
    })
  })

  describe('isWithinBounds', () => {
    it('is inclusive of both bounds', () => {
      expect(isWithinBounds(10n, 10n, 20n)).toBe(true)
      expect(isWithinBounds(20n, 10n, 20n)).toBe(true)
    })

    it('rejects values outside the bounds', () => {
      expect(isWithinBounds(9n, 10n, 20n)).toBe(false)
      expect(isWithinBounds(21n, 10n, 20n)).toBe(false)
    })
  })

  describe('isQuoteFresh', () => {
    const now = 1_000_000

    it('accepts a quote within the max age (inclusive boundary)', () => {
      expect(isQuoteFresh(now - 5_000, now, 10_000)).toBe(true)
      expect(isQuoteFresh(now - 10_000, now, 10_000)).toBe(true)
    })

    it('rejects a quote older than the max age', () => {
      expect(isQuoteFresh(now - 10_001, now, 10_000)).toBe(false)
    })
  })
})

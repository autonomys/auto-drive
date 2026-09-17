import { describe, it, expect } from '@jest/globals'
import { USD_RATE_SCALE } from '@auto-drive/models'
import {
  parseDecimalToScaledBigint,
  isWithinBounds,
  isFresh,
  swapPrice,
  medianPrice,
  trimOutliers,
  volumeWeightedPrice,
  windowVolumeUsdc,
  oneSidedVolumeUsdc,
} from '../../../src/infrastructure/services/priceOracle/quote.js'
import type { SwapSample } from '../../../src/infrastructure/services/priceOracle/types.js'

// One whole USDC and one whole AI3, in their own base units.
const USDC = 1_000_000n
const AI3 = 1_000_000_000_000_000_000n

// A swap of `usdc` whole USDC against `ai3` whole AI3 — i.e. a realized price of
// usdc/ai3 USD per AI3.
const swap = (usdc: number, ai3: number, overrides: Partial<SwapSample> = {}) =>
  ({
    usdcAmount: BigInt(Math.round(usdc * 1e6)),
    ai3Amount: BigInt(Math.round(ai3 * 1e6)) * 10n ** 12n,
    // The statistics here are direction-blind — a fill's price is the ratio of
    // its legs either way — so the default is arbitrary and the field exists for
    // the reporting layer above.
    direction: 'sell',
    timestampMs: 1_700_000_000_000,
    ...overrides,
  }) satisfies SwapSample

describe('priceOracle/quote', () => {
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

    it('scales to a caller-supplied precision (USDC is 6dp)', () => {
      expect(parseDecimalToScaledBigint('1000', 6)).toBe(1_000_000_000n)
      expect(parseDecimalToScaledBigint('0.5', 6)).toBe(500_000n)
    })

    it('rejects exponential notation, signs, and non-decimals', () => {
      expect(() => parseDecimalToScaledBigint('1e-3')).toThrow()
      expect(() => parseDecimalToScaledBigint('-1')).toThrow()
      expect(() => parseDecimalToScaledBigint('')).toThrow()
      expect(() => parseDecimalToScaledBigint('abc')).toThrow()
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

  describe('isFresh', () => {
    const now = 1_000_000

    it('accepts an observation within the max age (inclusive boundary)', () => {
      expect(isFresh(now - 5_000, now, 10_000)).toBe(true)
      expect(isFresh(now - 10_000, now, 10_000)).toBe(true)
    })

    it('rejects an observation older than the max age', () => {
      expect(isFresh(now - 10_001, now, 10_000)).toBe(false)
    })
  })

  describe('swapPrice', () => {
    it('prices a swap from the ratio of its legs', () => {
      // 6.4 USDC for 1000 AI3 = 0.0064 USD/AI3
      expect(swapPrice(swap(6.4, 1000))).toBe(6_400_000_000_000_000n)
    })

    it('is independent of trade size at the same rate', () => {
      expect(swapPrice(swap(6.4, 1000))).toBe(swapPrice(swap(64, 10_000)))
    })

    it('refuses a sample with no AI3 leg rather than dividing by zero', () => {
      expect(() => swapPrice(swap(5, 0))).toThrow(/no price/)
    })
  })

  describe('medianPrice', () => {
    it('takes the middle value of an odd-length window', () => {
      expect(medianPrice([30n, 10n, 20n])).toBe(20n)
    })

    it('averages the two middle values of an even-length window', () => {
      expect(medianPrice([10n, 20n, 30n, 40n])).toBe(25n)
    })

    it('refuses an empty window', () => {
      expect(() => medianPrice([])).toThrow(/empty/)
    })
  })

  describe('trimOutliers', () => {
    const maxDeviationBps = 2_500n // 25%

    it('keeps a window whose prices agree', () => {
      const samples = [swap(6.4, 1000), swap(6.5, 1000), swap(6.3, 1000)]

      const { kept, dropped } = trimOutliers(samples, maxDeviationBps)

      expect(dropped).toBe(0)
      expect(kept).toHaveLength(3)
    })

    it('drops a swap that printed far from the median', () => {
      const samples = [
        swap(6.4, 1000),
        swap(6.5, 1000),
        swap(6.3, 1000),
        swap(64, 1000), // 10x the others
      ]

      const { kept, dropped } = trimOutliers(samples, maxDeviationBps)

      expect(dropped).toBe(1)
      expect(kept.map(swapPrice)).not.toContain(64_000_000_000_000_000n)
    })

    it('measures against the median, so one huge outlier cannot admit itself', () => {
      // With a mean reference, a 100x print drags the threshold up far enough to
      // survive its own filter. The median is unmoved by it.
      const samples = [
        swap(6.4, 1000),
        swap(6.4, 1000),
        swap(6.4, 1000),
        swap(640, 1000),
      ]

      expect(trimOutliers(samples, maxDeviationBps).dropped).toBe(1)
    })

    it('keeps a large swap that priced in line — weight is not suspicion', () => {
      const samples = [
        swap(6.4, 1000),
        swap(6.4, 1000),
        swap(6_400, 1_000_000), // same rate, 1000x the size
      ]

      expect(trimOutliers(samples, maxDeviationBps).dropped).toBe(0)
    })

    it('is inclusive at the threshold', () => {
      // Median 0.0064; a sample exactly 25% above sits at 0.008.
      const samples = [swap(6.4, 1000), swap(6.4, 1000), swap(8, 1000)]

      expect(trimOutliers(samples, maxDeviationBps).dropped).toBe(0)
    })

    it('reports an empty window without throwing', () => {
      expect(trimOutliers([], maxDeviationBps)).toEqual({
        kept: [],
        dropped: 0,
      })
    })
  })

  describe('volumeWeightedPrice', () => {
    it('weights each swap by its own size', () => {
      // 1 AI3 at 0.01 and 9 AI3 at 0.001 -> (0.01 + 0.009) / 10 = 0.0019
      const samples = [swap(0.01, 1), swap(0.009, 9)]

      expect(volumeWeightedPrice(samples)).toBe(1_900_000_000_000_000n)
    })

    it('is dominated by the large fill, not by the number of small ones', () => {
      const dust = Array.from({ length: 9 }, () => swap(0.01, 1)) // 0.01 each
      const real = swap(6.4, 1000) // 0.0064, and 1000x the volume

      const vwap = volumeWeightedPrice([...dust, real])

      // Nine dust swaps at 0.01 move the average by well under a tenth of a
      // percent, where a count-weighted mean would land near 0.0096.
      expect(vwap).toBeGreaterThan(6_400_000_000_000_000n)
      expect(vwap).toBeLessThan(6_440_000_000_000_000n)
    })

    it('equals the single price when every swap agrees', () => {
      const samples = [swap(6.4, 1000), swap(12.8, 2000), swap(3.2, 500)]

      expect(volumeWeightedPrice(samples)).toBe(6_400_000_000_000_000n)
    })

    it('refuses an empty window', () => {
      expect(() => volumeWeightedPrice([])).toThrow(/empty/)
    })

    it('refuses a window with no AI3 volume', () => {
      expect(() => volumeWeightedPrice([swap(5, 0)])).toThrow(/zero/)
    })
  })

  describe('windowVolumeUsdc', () => {
    it('sums the USDC legs', () => {
      expect(windowVolumeUsdc([swap(6.4, 1000), swap(3.6, 500)])).toBe(
        10n * USDC,
      )
    })

    it('is zero for an empty window', () => {
      expect(windowVolumeUsdc([])).toBe(0n)
    })
  })

  describe('oneSidedVolumeUsdc', () => {
    it('counts one side of a round trip, not both', () => {
      // $6.40 in and $6.40 back out: the total says 12.80 traded, but 6.40 was
      // committed and the net position is nothing. This is what makes a volume
      // floor cheap to clear by churning — the fee on the churn is all it costs.
      const roundTrip = [
        swap(6.4, 1000, { direction: 'buy' }),
        swap(6.4, 1000, { direction: 'sell' }),
      ]

      expect(windowVolumeUsdc(roundTrip)).toBe(12n * USDC + 800_000n)
      expect(oneSidedVolumeUsdc(roundTrip)).toBe(6n * USDC + 400_000n)
    })

    it('takes the larger side', () => {
      const samples = [
        swap(3, 500, { direction: 'buy' }),
        swap(2, 300, { direction: 'buy' }),
        swap(4, 600, { direction: 'sell' }),
      ]

      expect(oneSidedVolumeUsdc(samples)).toBe(5n * USDC)
    })

    it('costs one-directional flow nothing', () => {
      // Honest flow that only goes one way scores its full volume either way, so
      // the tightening falls on churn rather than on traders.
      const sells = [
        swap(6, 1000, { direction: 'sell' }),
        swap(4, 700, { direction: 'sell' }),
      ]

      expect(oneSidedVolumeUsdc(sells)).toBe(windowVolumeUsdc(sells))
    })

    it('is zero for an empty window', () => {
      expect(oneSidedVolumeUsdc([])).toBe(0n)
    })
  })

  // Guards against a silent unit slip in the fixtures above: one whole AI3 is
  // 1e18 base units, one whole USDC 1e6.
  it('fixture helper produces the base units it claims', () => {
    const sample = swap(1, 1)
    expect(sample.usdcAmount).toBe(USDC)
    expect(sample.ai3Amount).toBe(AI3)
  })
})

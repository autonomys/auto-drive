import { describe, it, expect } from '@jest/globals'
import { timeWeightedAverage } from '../../../src/infrastructure/services/priceOracle/quote.js'
import type { PricePoint } from '../../../src/infrastructure/services/priceOracle/types.js'

// 0.0064 and 0.0032 USD/AI3, scaled 1e18.
const PRICE = 6_400_000_000_000_000n
const HALF = PRICE / 2n

const FROM = 21_000_000n
const TO = FROM + 7_200n // ~24h of Ethereum blocks

const at = (offset: bigint, usdPerAi3: bigint): PricePoint => ({
  blockNumber: FROM + offset,
  usdPerAi3,
})

describe('timeWeightedAverage', () => {
  it('is the seed price when the pool never traded in the window', () => {
    // Not an edge case. Measured on the live WAI3/USDC pool: zero swaps in the
    // last 24 hours, and a 19-day gap between trades at its quietest. Without
    // the seed there would be no reference at all on most days.
    expect(timeWeightedAverage(PRICE, [], FROM, TO)).toBe(PRICE)
  })

  it('weights each price by how long it stood, not by how often it traded', () => {
    // One price standing for 90% of the window against nine later prices
    // crammed into the last 10%. A trade-count window would be carried by the
    // nine; time-weighting is carried by the one — which is what stops dust wash
    // trades from filling the window.
    const busyTail = Array.from({ length: 9 }, (_, i) =>
      at(6_480n + BigInt(i) * 80n, HALF),
    )

    const average = timeWeightedAverage(PRICE, busyTail, FROM, TO)

    // 90% at PRICE, ~10% at HALF -> just under 95% of PRICE.
    expect(average).toBeGreaterThan((PRICE * 94n) / 100n)
    expect(average).toBeLessThan((PRICE * 96n) / 100n)
  })

  it('splits the window evenly for a single mid-window move', () => {
    const average = timeWeightedAverage(PRICE, [at(3_600n, HALF)], FROM, TO)
    expect(average).toBe((PRICE + HALF) / 2n)
  })

  it('gives a swap in the final block no weight at all', () => {
    // So the price being judged can never dilute the average it is judged
    // against — the flaw that sampling *behind* the block existed to avoid.
    expect(timeWeightedAverage(PRICE, [at(7_200n, HALF)], FROM, TO)).toBe(PRICE)
  })

  it('barely moves for a push held one block', () => {
    // 1 block out of 7200. The whole point of the window: a price has to be HELD
    // to shift the average, and holding is what costs the attacker.
    const average = timeWeightedAverage(
      PRICE,
      [at(7_199n, HALF), at(7_200n, PRICE)],
      FROM,
      TO,
    )
    expect(average).toBeGreaterThan((PRICE * 9_999n) / 10_000n)
  })

  it('ignores observations outside the window', () => {
    const average = timeWeightedAverage(
      PRICE,
      [
        { blockNumber: FROM - 10n, usdPerAi3: HALF }, // before
        { blockNumber: FROM, usdPerAi3: HALF }, // at the seed block
        { blockNumber: TO + 10n, usdPerAi3: HALF }, // after
      ],
      FROM,
      TO,
    )
    expect(average).toBe(PRICE)
  })

  it('does not depend on the order observations arrive in', () => {
    const points = [at(1_800n, HALF), at(3_600n, PRICE), at(5_400n, HALF)]
    const shuffled = [points[2], points[0], points[1]]
    expect(timeWeightedAverage(PRICE, shuffled, FROM, TO)).toBe(
      timeWeightedAverage(PRICE, points, FROM, TO),
    )
  })

  it('takes the last of several swaps in the same block', () => {
    // Two swaps in one block: the first is instantly superseded, so only the
    // price the block ended at can stand for any time.
    const average = timeWeightedAverage(
      PRICE,
      [at(3_600n, 1n), at(3_600n, HALF)],
      FROM,
      TO,
    )
    expect(average).toBe((PRICE + HALF) / 2n)
  })

  it('rejects an empty or inverted window', () => {
    expect(() => timeWeightedAverage(PRICE, [], FROM, FROM)).toThrow()
    expect(() => timeWeightedAverage(PRICE, [], TO, FROM)).toThrow()
  })
})

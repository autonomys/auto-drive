import { USD_RATE_DECIMALS } from '@auto-drive/models'
import type { PricePoint } from './types.js'

/**
 * Parse a non-negative decimal string into an integer scaled by
 * 10^scaleDecimals, using string math (never float multiplication) so values
 * with many significant digits scale exactly — `Number(x) * 1e18` loses
 * precision once the product exceeds 2^53 (e.g. any AI3 price >= ~$0.009).
 *
 * Rejects anything that is not a plain non-negative decimal (signs, exponential
 * notation, empty) so a malformed API value fails loudly instead of being
 * silently mis-scaled. Fractional digits beyond `scaleDecimals` are truncated
 * (their value is below one base unit at 1e18).
 */
export const parseDecimalToScaledBigint = (
  input: string,
  scaleDecimals: number = USD_RATE_DECIMALS,
): bigint => {
  const value = input.trim()
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal price: "${input}"`)
  }
  const [whole, fraction = ''] = value.split('.')
  const scaledFraction = (fraction + '0'.repeat(scaleDecimals)).slice(
    0,
    scaleDecimals,
  )
  return BigInt(whole) * 10n ** BigInt(scaleDecimals) + BigInt(scaledFraction)
}

// Sanity bound (inclusive): reject an absurd price — a source glitch or the
// wrong asset — before it is trusted.
export const isWithinBounds = (
  value: bigint,
  minInclusive: bigint,
  maxInclusive: bigint,
): boolean => value >= minInclusive && value <= maxInclusive

// A quote is fresh when it was updated no more than `maxAgeMs` before `nowMs`.
// Only applied when the source reports its own update time.
export const isQuoteFresh = (
  asOfMs: number,
  nowMs: number,
  maxAgeMs: number,
): boolean => nowMs - asOfMs <= maxAgeMs

/**
 * Time-weighted average price over `(fromBlock, toBlock]`, given the price
 * standing at `fromBlock` and every price change inside the window.
 *
 * An AMM price is a step function: it holds whatever the last swap left until
 * the next swap moves it. So the average is each observed price weighted by how
 * long it stood, which is what makes it expensive to move — a price must be HELD
 * to shift the average, not merely printed. Weighting by trade count instead
 * would be attacker-controlled, since dust wash trades can fill a count window.
 *
 * Blocks are the time unit rather than seconds. Ethereum slots are 12s by
 * protocol, so a block delta is a proportional time delta up to missed slots
 * (~1% of slots, and they lengthen every segment equally). Buying that last
 * fraction of a percent would cost one `eth_getBlockByNumber` per swap in the
 * window, which is the difference between two RPC calls and dozens.
 *
 * `seedUsdPerAi3` covers the window from `fromBlock` up to the first
 * observation, and is load-bearing rather than an edge case: this pool can go
 * days without a trade, in which case the whole window is the seed and there is
 * no other price to average.
 *
 * Observations at or before `fromBlock`, or after `toBlock`, are ignored. Two
 * swaps in the same block collapse correctly — the earlier one gets zero weight
 * and the later one carries forward — provided they arrive in log order, which
 * the sort below preserves. Note that a swap landing IN `toBlock` also gets zero
 * weight, so the price being judged can never dilute the average it is judged
 * against.
 *
 * @throws if the window is empty or inverted.
 */
export const timeWeightedAverage = (
  seedUsdPerAi3: bigint,
  observations: PricePoint[],
  fromBlock: bigint,
  toBlock: bigint,
): bigint => {
  const span = toBlock - fromBlock
  if (span <= 0n) {
    throw new Error(
      `Invalid TWAP window: ${fromBlock}..${toBlock} spans no blocks`,
    )
  }

  // Stable sort by block, so multiple swaps in one block keep their log order.
  const ordered = [...observations].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
  )

  let weighted = 0n
  let cursor = fromBlock
  let standing = seedUsdPerAi3
  for (const point of ordered) {
    if (point.blockNumber <= fromBlock || point.blockNumber > toBlock) {
      continue
    }
    weighted += standing * (point.blockNumber - cursor)
    cursor = point.blockNumber
    standing = point.usdPerAi3
  }
  weighted += standing * (toBlock - cursor)
  return weighted / span
}

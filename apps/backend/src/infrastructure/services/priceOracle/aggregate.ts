import { USD_RATE_DECIMALS } from '@auto-drive/models'

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

/**
 * Median of a non-empty list of bigints. For an even count returns the integer
 * mean of the two middle values (floor division; sub-unit loss is negligible at
 * 1e18 scale). Throws on an empty list — callers must enforce minSources first.
 */
export const median = (values: bigint[]): bigint => {
  if (values.length === 0) {
    throw new Error('Cannot compute the median of an empty list')
  }
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2n
}

// Sanity bound (inclusive): reject absurd prices — a source glitch or the wrong
// asset — before they can poison the median.
export const isWithinBounds = (
  value: bigint,
  minInclusive: bigint,
  maxInclusive: bigint,
): boolean => value >= minInclusive && value <= maxInclusive

// A source quote is fresh when it was updated no more than `maxAgeMs` before
// `nowMs`. Only applied when the source reports its own update time.
export const isQuoteFresh = (
  asOfMs: number,
  nowMs: number,
  maxAgeMs: number,
): boolean => nowMs - asOfMs <= maxAgeMs

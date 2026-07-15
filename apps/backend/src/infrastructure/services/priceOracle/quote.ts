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

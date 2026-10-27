import { USD_RATE_DECIMALS } from '@auto-drive/models'
import { USDC_CONVERSION_FACTOR } from '../../../shared/utils/pricing.js'
import type { SwapSample } from './types.js'

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

// Something observed at `asOfMs` is fresh when it is no more than `maxAgeMs`
// old at `nowMs`. Applied twice, to two different clocks: the newest swap in
// the window (has the market moved recently?) and the indexer head (is the
// source still reporting?).
export const isFresh = (
  asOfMs: number,
  nowMs: number,
  maxAgeMs: number,
): boolean => nowMs - asOfMs <= maxAgeMs

// USDC has 6 decimals, AI3 18, and prices are scaled by 1e18:
//
//   usdPerAi3 = (usdc / 10^6) / (ai3 / 10^18) * 10^18
//             = usdc * 10^(18 + 18 - 6) / ai3
//
// That is the same 10^30 the quoting layer multiplies BY to turn a rate back
// into a USDC charge, so it is imported rather than restated: two definitions
// of one factor is two things that must agree, on the path that decides what a
// user is charged. `ai3ShannonsToUsdcBaseUnits` is this function's inverse.
const PRICE_CONVERSION_FACTOR = USDC_CONVERSION_FACTOR

/**
 * The price a single swap actually filled at, scaled by USD_RATE_SCALE (1e18).
 *
 * This is a realized price, not a quoted one: whatever the pool charged for
 * that trade — swap fee, price impact and all — is already inside the ratio of
 * its two legs. That is the whole reason the oracle reads trades rather than
 * pool state.
 *
 * @throws if the AI3 leg is zero, which is not a price but a division by zero.
 *         Callers drop such samples while mapping, so this is a guard against
 *         a mapping bug rather than an expected input.
 */
export const swapPrice = (sample: SwapSample): bigint => {
  if (sample.ai3Amount <= 0n) {
    throw new Error(
      `Invalid swap sample: AI3 leg is ${sample.ai3Amount}, so it has no price`,
    )
  }
  return (sample.usdcAmount * PRICE_CONVERSION_FACTOR) / sample.ai3Amount
}

/**
 * Median of a non-empty list of scaled prices.
 *
 * Used as the reference the outlier trim measures against, deliberately rather
 * than the mean: the mean is moved by the very outliers the trim exists to
 * remove, so trimming against it would let one extreme swap drag the threshold
 * far enough to admit itself.
 *
 * Even-length windows average the two middle values, which is why this returns
 * a price rather than one of its inputs.
 *
 * @throws on an empty list — an empty window is a guard's problem, not a
 *         statistic to compute.
 */
export const medianPrice = (prices: bigint[]): bigint => {
  if (prices.length === 0) {
    throw new Error('Cannot take the median of an empty window')
  }
  const ordered = [...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2n
}

const BASIS_POINTS = 10_000n

/**
 * Drop swaps whose price sits further than `maxDeviationBps` from the window's
 * median.
 *
 * A thin pool is cheap to print a silly price on, and one absurd fill inside a
 * ten-swap window would otherwise drag the average by a tenth of its error.
 * Volume weighting alone does not cover this: the manipulating trade can simply
 * be large, in which case its weight is exactly what makes it dangerous.
 *
 * Symmetric, unlike the spot-vs-average gate this replaces. That gate compared
 * one live price against a trailing baseline and could reason about which
 * direction an attacker profits from; here every sample is a past fill, and a
 * fill far from its neighbours is equally suspect in either direction.
 *
 * Returns the survivors and how many were dropped, so the caller can re-check
 * the sample-count floor — trimming a window down to two swaps produces a
 * "clean" average that no longer means anything.
 */
export const trimOutliers = (
  samples: SwapSample[],
  maxDeviationBps: bigint,
): { kept: SwapSample[]; dropped: number } => {
  if (samples.length === 0) {
    return { kept: [], dropped: 0 }
  }
  const median = medianPrice(samples.map(swapPrice))
  // A zero median means every sample priced below one base unit of the 1e18
  // scale; there is no meaningful reference to trim against, so keep the window
  // intact and let the bounds guard reject the result.
  if (median <= 0n) {
    return { kept: samples, dropped: 0 }
  }
  const kept = samples.filter((sample) => {
    const price = swapPrice(sample)
    const delta = price > median ? price - median : median - price
    return (delta * BASIS_POINTS) / median <= maxDeviationBps
  })
  return { kept, dropped: samples.length - kept.length }
}

/**
 * Volume-weighted average price across a window of swaps, scaled by
 * USD_RATE_SCALE (1e18).
 *
 * Summing both legs before dividing IS the volume weighting — a swap's
 * influence is its own size, with no explicit weight term — and it keeps the
 * whole computation to one division, so the result carries one rounding error
 * instead of one per swap.
 *
 * Weighting by size rather than by count is the manipulation-resistant choice
 * available to a trade-history oracle: a count-weighted window is filled by
 * dust wash trades, while moving a volume-weighted one costs real volume
 * against the pool's own fee.
 *
 * @throws if the window is empty or its AI3 legs sum to zero.
 */
export const volumeWeightedPrice = (samples: SwapSample[]): bigint => {
  if (samples.length === 0) {
    throw new Error('Cannot average an empty window')
  }
  let usdcTotal = 0n
  let ai3Total = 0n
  for (const sample of samples) {
    usdcTotal += sample.usdcAmount
    ai3Total += sample.ai3Amount
  }
  if (ai3Total <= 0n) {
    throw new Error('Cannot average a window whose AI3 volume is zero')
  }
  return (usdcTotal * PRICE_CONVERSION_FACTOR) / ai3Total
}

// Total USDC base units traded across a window — the weight behind its average,
// and what an operator means by "how much traded".
export const windowVolumeUsdc = (samples: SwapSample[]): bigint =>
  samples.reduce((total, sample) => total + sample.usdcAmount, 0n)

/**
 * USDC volume of the window's LARGER side — the figure the thin-volume floor
 * judges, rather than the total.
 *
 * A round trip contributes both of its legs to the total while committing capital
 * only once: buy $500 of AI3 and sell it straight back and the total records
 * ~$1000 traded against $500 committed and a net position of nothing. Judging the
 * larger side alone cannot be inflated that way, so clearing the floor by
 * churning costs about twice what it did.
 *
 * It never overstates what was committed, and it costs honest flow at most a
 * factor of two — one-directional flow scores its full volume either way, and a
 * perfectly balanced window scores half. That is a real tightening of the floor
 * for real traders, which is why this is the SECOND barrier here rather than the
 * main one: volume is a proxy for depth, and depth is now read directly.
 */
export const oneSidedVolumeUsdc = (samples: SwapSample[]): bigint => {
  let buy = 0n
  let sell = 0n
  for (const sample of samples) {
    if (sample.direction === 'buy') {
      buy += sample.usdcAmount
    } else {
      sell += sample.usdcAmount
    }
  }
  return buy > sell ? buy : sell
}

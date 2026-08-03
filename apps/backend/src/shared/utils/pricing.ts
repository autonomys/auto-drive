import { USD_RATE_DECIMALS } from '@auto-drive/models'

// AI3 base units (shannons) per whole AI3, and USDC base units per whole USDC.
const AI3_DECIMALS = 18
const USDC_DECIMALS = 6

// The USD value of `shannons` at `usdPerAi3` (scaled 1e18), expressed in USDC
// base units, is:
//
//   (shannons / 10^18) * (usdPerAi3 / 10^18) * 10^6
//     = shannons * usdPerAi3 / 10^(18 + 18 - 6)
const USDC_CONVERSION_EXPONENT = BigInt(
  AI3_DECIMALS + USD_RATE_DECIMALS - USDC_DECIMALS,
)

/**
 * Convert an AI3 amount (shannons) into its USDC-base-unit value at a given
 * AI3/USD rate, using integer math throughout.
 *
 * This is the *marginal* value — the rate times the size, ignoring what the
 * trade would do to the pool. Use it for display, for the persisted locked rate,
 * and as the baseline that price impact is measured against; use the oracle's
 * executable quote for the amount actually charged.
 *
 * Rounds UP, which is the right direction for a charge. Note the effect where
 * it serves as the price-impact baseline is the opposite — a larger baseline
 * makes the measured impact marginally smaller, so the guard is very slightly
 * more permissive. The bias is at most one USDC base unit (1e-6 USD) against a
 * baseline of the whole purchase, so it is dominated by the guard's own
 * threshold rather than being a meaningful loosening.
 *
 * @throws if either argument is negative.
 */
export const ai3ShannonsToUsdcBaseUnits = (
  shannons: bigint,
  usdPerAi3: bigint,
): bigint => {
  if (shannons < 0n) {
    throw new Error(`Invalid AI3 amount: ${shannons}`)
  }
  if (usdPerAi3 < 0n) {
    throw new Error(`Invalid AI3/USD rate: ${usdPerAi3}`)
  }
  const divisor = 10n ** USDC_CONVERSION_EXPONENT
  return (shannons * usdPerAi3 + divisor - 1n) / divisor
}

/**
 * Add a percentage margin to a base amount expressed in its own smallest unit
 * (e.g. USDC 6-decimal base units), using integer math.
 *
 * Turns the raw oracle-derived USD cost of an intent into the amount actually
 * charged to the user (config.credits.usdQuoteMarginPercent). The stored
 * usdRateAtCreation stays the raw market rate; only the charged amount carries
 * the margin. The percent is converted to basis points (so fractional percents
 * like 2.5 work) and the result is rounded UP so rounding never undercharges.
 *
 * Apply this to the oracle's EXECUTABLE quote (`ExecutableQuote.usdcAmount`),
 * not to the marginal value: the executable quote already covers the swap fee
 * and the trade's own price impact at quote time, and this margin covers what it
 * cannot — drift between quoting and converting, while the intent's price lock
 * is open. Applying it to the marginal value instead would discard the reason
 * the executable quote is read at all. Note the resulting all-in spread is the
 * margin *plus* the pool fee plus impact, so size the percent knowing the other
 * two are already in the base.
 *
 * @throws if `amount` is negative, or `percent` is negative or not finite.
 */
export const applyMarginPercent = (amount: bigint, percent: number): bigint => {
  if (amount < 0n) {
    throw new Error(`Invalid amount: ${amount}`)
  }
  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error(`Invalid margin percent: ${percent}`)
  }
  const BASIS_POINTS = 10000n
  const marginBasisPoints = BigInt(Math.round(percent * 100))
  const numerator = amount * (BASIS_POINTS + marginBasisPoints)
  // Ceiling division (amount is non-negative) so we never charge less than the
  // exact margined value.
  return (numerator + BASIS_POINTS - 1n) / BASIS_POINTS
}

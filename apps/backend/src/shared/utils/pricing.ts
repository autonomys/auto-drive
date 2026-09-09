import { USD_RATE_DECIMALS } from '@auto-drive/models'

// AI3 base units (shannons) per whole AI3, and USDC base units per whole USDC.
// Exported as the single definition: the oracle derives a rate with these and
// this module prices a purchase with them, and the two are only inverses of
// each other while they agree.
export const AI3_DECIMALS = 18
export const USDC_DECIMALS = 6

// The USD value of `shannons` at `usdPerAi3` (scaled 1e18), expressed in USDC
// base units, is:
//
//   (shannons / 10^18) * (usdPerAi3 / 10^18) * 10^6
//     = shannons * usdPerAi3 / 10^(18 + 18 - 6)
//
// The oracle inverts this exact relation to turn a swap's two legs into a
// price, so the factor is exported rather than restated there.
export const USDC_CONVERSION_EXPONENT = BigInt(
  AI3_DECIMALS + USD_RATE_DECIMALS - USDC_DECIMALS,
)
export const USDC_CONVERSION_FACTOR = 10n ** USDC_CONVERSION_EXPONENT

/**
 * Convert an AI3 amount (shannons) into its USDC-base-unit value at a given
 * AI3/USD rate, using integer math throughout.
 *
 * The rate is the oracle's volume-weighted average of recent fills, which is
 * size-independent: the same number prices a $5 purchase and a $500 one. It is
 * therefore the basis for display, for the persisted locked rate, and — once
 * `applyMarginPercent` is on top — for the amount actually charged.
 *
 * Rounds UP, which is the right direction for a charge.
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
  return (
    (shannons * usdPerAi3 + USDC_CONVERSION_FACTOR - 1n) /
    USDC_CONVERSION_FACTOR
  )
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
 * Apply this to the USD value of the purchase at the oracle's rate
 * (`ai3ShannonsToUsdcBaseUnits`). It is the ONLY wedge between the rate shown
 * and the rate charged, and it carries everything the average cannot know:
 * drift while the intent's price lock is open, and — since USDC is now
 * converted manually and in batches rather than swapped per intent — the cost
 * of eventually converting a batch through a pool this thin. Size it against
 * realized conversions (see the treasury reconciliation), not against a single
 * purchase's slippage.
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


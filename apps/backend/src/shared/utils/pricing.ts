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

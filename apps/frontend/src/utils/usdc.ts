/**
 * Buyer-facing USDC formatting. Pure, so it can be tested without React.
 *
 * Deliberately NOT `formatUsdcBaseUnits` from @auto-drive/models. That one
 * truncates to two decimals and is documented as operator-facing — right for a
 * Slack alert about a treasury balance, wrong here. This is the exact amount a
 * user is being asked to transfer, and a displayed figure that is even a
 * fraction of a cent below the real one is a figure they can reconcile against
 * their wallet and find wrong.
 *
 * The two are different jobs rather than a duplicated one: a summary that reads
 * well under pressure, and a charge that has to be exact.
 *
 * The scale is a PARAMETER rather than a constant here, taken from
 * `UsdcPaymentTarget.tokenDecimals`. The deployment reports what it accepts and
 * every figure a buyer is shown is rendered against that, so a display cannot
 * disagree with the backend that does the crediting.
 */

/**
 * Fallback decimals, for the one caller that has no target in hand yet.
 *
 * Every real render passes `UsdcPaymentTarget.tokenDecimals` — what the
 * deployment says it accepts — rather than trusting this. The constant exists so
 * a display before the target lands is not a crash.
 */
const DEFAULT_USDC_DECIMALS = 6;

/**
 * Render token base units as an exact decimal figure.
 *
 * All-integer arithmetic: `Number(baseUnits) / 1e6` is exact for every amount a
 * purchase could plausibly be, but "plausibly" is not a property worth relying
 * on for the number under a Pay button, and the integer path costs nothing.
 *
 * Trailing zeros are trimmed to at least two decimals, so an amount lands as
 * "12.50" rather than "12.500000" and a fractional remainder still shows in
 * full: "12.505001".
 */
export const formatUsdcAmount = (
  baseUnits: bigint,
  decimals: number = DEFAULT_USDC_DECIMALS,
): string => {
  // BigInt(...) rather than the `0n` literal syntax: this app's tsconfig targets
  // below ES2020, where the literal form does not compile.
  // The scale is the token's own, never clamped — rounding a 2-decimal token to
  // 6 places is one thing, but scaling it by 10^6 would misstate the charge by
  // four orders of magnitude. Only the DISPLAY has a floor.
  const places = Math.max(0, Math.trunc(decimals));
  const scale = BigInt(10) ** BigInt(places);
  const negative = baseUnits < BigInt(0);
  const absolute = negative ? -baseUnits : baseUnits;

  const whole = (absolute / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (absolute % scale)
    .toString()
    .padStart(places, '0')
    // Trim trailing zeros...
    .replace(/(\d*?)0+$/, '$1')
    // ...but never below two places, because a price with one decimal reads as
    // a typo and one with none reads as an integer count.
    .padEnd(2, '0');

  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

/**
 * Milliseconds left on a price lock, floored at zero.
 *
 * `now` is a parameter rather than a `Date.now()` call so the countdown can be
 * tested at an instant instead of around one.
 */
export const quoteRemainingMs = (
  expiresAt: Date | null,
  now: number,
): number | null => {
  if (!expiresAt) return null;
  return Math.max(0, expiresAt.getTime() - now);
};

/**
 * A price lock as "4:07" — the shape every countdown a user has ever read uses.
 *
 * Returns null when there is nothing to count down to, so a caller renders
 * nothing rather than a placeholder that looks like a stopped clock.
 */
export const formatQuoteCountdown = (
  expiresAt: Date | null,
  now: number,
): string | null => {
  const remaining = quoteRemainingMs(expiresAt, now);
  if (remaining === null) return null;
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

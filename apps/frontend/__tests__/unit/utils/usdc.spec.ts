/**
 * The number under the Pay button, and the clock next to it.
 *
 * `formatUsdcAmount` renders the exact amount a wallet is about to be asked to
 * move, which is why it is not `formatUsdcBaseUnits` from @auto-drive/models:
 * that one truncates to two decimals for operator-facing text, and a charge
 * displayed a fraction of a cent below the real one is a figure a buyer can
 * reconcile against their wallet and find wrong.
 */

import {
  formatQuoteCountdown,
  formatUsdcAmount,
  quoteRemainingMs,
} from '../../../src/utils/usdc';

describe('formatUsdcAmount', () => {
  it('renders whole dollars with two decimals', () => {
    // Not "12" and not "12.0": a price with fewer than two decimals reads as a
    // typo rather than a price.
    expect(formatUsdcAmount(12_000_000n)).toBe('12.00');
  });

  it('keeps every significant base unit', () => {
    // The whole reason this is not the models formatter. Truncating here would
    // display 12.50 for an amount that is 12.505001, and the wallet would then
    // ask for a different number than the screen promised.
    expect(formatUsdcAmount(12_505_001n)).toBe('12.505001');
  });

  it('trims trailing zeros but never below two decimals', () => {
    expect(formatUsdcAmount(12_500_000n)).toBe('12.50');
    expect(formatUsdcAmount(12_050_000n)).toBe('12.05');
    expect(formatUsdcAmount(12_005_000n)).toBe('12.005');
  });

  it('groups thousands', () => {
    expect(formatUsdcAmount(1_234_567_890_000n)).toBe('1,234,567.89');
  });

  it('renders sub-dollar amounts', () => {
    expect(formatUsdcAmount(1n)).toBe('0.000001');
    expect(formatUsdcAmount(500_000n)).toBe('0.50');
    expect(formatUsdcAmount(0n)).toBe('0.00');
  });

  it('survives an amount past Number.MAX_SAFE_INTEGER', () => {
    // All-integer arithmetic. `Number(baseUnits) / 1e6` is exact for every
    // plausible purchase, but "plausible" is not a property to rely on for a
    // charge, and this is the case that would silently round.
    expect(formatUsdcAmount(9_007_199_254_740_993_000_000n)).toBe(
      '9,007,199,254,740,993.00',
    );
  });

  it('renders against the decimals the deployment reports, not a constant', () => {
    // `tokenDecimals` comes from GET /payments/usdc/target. Hard-coding six here
    // would let a display disagree with the backend that does the crediting,
    // which is the whole reason the field is served.
    expect(formatUsdcAmount(BigInt(12_500_000), 6)).toBe('12.50');
    // The same base units read as a very different charge at another scale.
    expect(formatUsdcAmount(BigInt(12_500_000), 8)).toBe('0.125');
    expect(formatUsdcAmount(BigInt(12_500_000), 2)).toBe('125,000.00');
  });

  it('defaults to six when no scale is given', () => {
    expect(formatUsdcAmount(BigInt(12_500_000))).toBe('12.50');
  });

  it("scales by the token's own decimals and only floors the DISPLAY", () => {
    // Clamping the scale rather than the display would misstate a 2-decimal
    // token's charge by four orders of magnitude. 100 base units of a
    // 1-decimal token is ten of them, shown to two places.
    expect(formatUsdcAmount(BigInt(100), 1)).toBe('10.00');
    expect(formatUsdcAmount(BigInt(100), 0)).toBe('100.00');
  });
});

describe('quoteRemainingMs', () => {
  const now = new Date('2026-08-27T12:00:00Z').getTime();

  it('is the gap to expiry', () => {
    expect(quoteRemainingMs(new Date(now + 90_000), now)).toBe(90_000);
  });

  it('floors at zero rather than going negative', () => {
    // A negative remaining would render as "-1:-3" through the formatter below.
    expect(quoteRemainingMs(new Date(now - 5_000), now)).toBe(0);
  });

  it('is null with nothing to count down to', () => {
    // An AI3 intent, or a row created before the price lock existed. The caller
    // renders nothing, rather than a zero that looks like a stopped clock.
    expect(quoteRemainingMs(null, now)).toBeNull();
  });
});

describe('formatQuoteCountdown', () => {
  const now = new Date('2026-08-27T12:00:00Z').getTime();

  it('renders minutes and zero-padded seconds', () => {
    expect(formatQuoteCountdown(new Date(now + 247_000), now)).toBe('4:07');
    expect(formatQuoteCountdown(new Date(now + 600_000), now)).toBe('10:00');
  });

  it('reaches 0:00 at expiry and stays there', () => {
    expect(formatQuoteCountdown(new Date(now), now)).toBe('0:00');
    expect(formatQuoteCountdown(new Date(now - 60_000), now)).toBe('0:00');
  });

  it('rounds down, so the clock never claims time that has gone', () => {
    // 1,999ms left is one second, not two.
    expect(formatQuoteCountdown(new Date(now + 1_999), now)).toBe('0:01');
  });

  it('is null with no expiry', () => {
    expect(formatQuoteCountdown(null, now)).toBeNull();
  });
});

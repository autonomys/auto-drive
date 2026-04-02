import {
  UNITS,
  MIB_PER_UNIT,
  bestUnit,
  mibToDisplay,
  sanitizeAmountInput,
  inputToMib,
  isCustomAmountOverCap,
  computePaymentShannons,
} from '../../../src/utils/purchaseCredits';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('UNITS', () => {
  it('contains exactly MB, GB, TB in that order', () => {
    expect(UNITS).toEqual(['MB', 'GB', 'TB']);
  });
});

describe('MIB_PER_UNIT', () => {
  it('MB maps to 1 MiB', () => {
    expect(MIB_PER_UNIT.MB).toBe(1);
  });

  it('GB maps to 1024 MiB', () => {
    expect(MIB_PER_UNIT.GB).toBe(1024);
  });

  it('TB maps to 1,048,576 MiB (1024 * 1024)', () => {
    expect(MIB_PER_UNIT.TB).toBe(1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// bestUnit
// ---------------------------------------------------------------------------

describe('bestUnit', () => {
  it('returns MB for 0', () => {
    expect(bestUnit(0)).toBe('MB');
  });

  it('returns MB for negative values', () => {
    expect(bestUnit(-100)).toBe('MB');
  });

  it('returns MB for values below 1024 MiB', () => {
    expect(bestUnit(1)).toBe('MB');
    expect(bestUnit(512)).toBe('MB');
    expect(bestUnit(1023)).toBe('MB');
  });

  it('returns GB for exactly 1024 MiB (1 GiB)', () => {
    expect(bestUnit(1024)).toBe('GB');
  });

  it('returns GB for values in the GiB range', () => {
    expect(bestUnit(1025)).toBe('GB');
    expect(bestUnit(512 * 1024)).toBe('GB'); // 512 GiB
    expect(bestUnit(1024 * 1024 - 1)).toBe('GB'); // just under 1 TiB
  });

  it('returns TB for exactly 1024 GiB (1 TiB = 1,048,576 MiB)', () => {
    expect(bestUnit(1024 * 1024)).toBe('TB');
  });

  it('returns TB for values above 1 TiB', () => {
    expect(bestUnit(2 * 1024 * 1024)).toBe('TB');
  });
});

// ---------------------------------------------------------------------------
// mibToDisplay
// ---------------------------------------------------------------------------

describe('mibToDisplay', () => {
  it('returns empty string for 0', () => {
    expect(mibToDisplay(0, 'MB')).toBe('');
  });

  it('returns empty string for negative values', () => {
    expect(mibToDisplay(-1, 'GB')).toBe('');
  });

  it('converts MiB to MB (1:1)', () => {
    expect(mibToDisplay(10, 'MB')).toBe('10');
    expect(mibToDisplay(100, 'MB')).toBe('100');
  });

  it('converts MiB to GB (÷1024)', () => {
    expect(mibToDisplay(1024, 'GB')).toBe('1');
    expect(mibToDisplay(2048, 'GB')).toBe('2');
    expect(mibToDisplay(512, 'GB')).toBe('0.5');
  });

  it('converts MiB to TB (÷1048576)', () => {
    expect(mibToDisplay(1024 * 1024, 'TB')).toBe('1');
    expect(mibToDisplay(512 * 1024, 'TB')).toBe('0.5');
  });

  it('trims to 4 significant figures, no trailing zeros', () => {
    // 1 / 1024 ≈ 0.0009766 → 4 sig figs → 0.0009766
    expect(mibToDisplay(1, 'GB')).toBe('0.0009766');
    // 1023 MiB in GB = 0.999... → 4 sig figs → 0.9990
    // parseFloat("0.9990") => "0.999"
    expect(mibToDisplay(1023, 'GB')).toBe('0.999');
  });
});

// ---------------------------------------------------------------------------
// sanitizeAmountInput
// ---------------------------------------------------------------------------

describe('sanitizeAmountInput', () => {
  it('passes through a simple integer string', () => {
    expect(sanitizeAmountInput('100')).toBe('100');
  });

  it('passes through a decimal string', () => {
    expect(sanitizeAmountInput('1.5')).toBe('1.5');
  });

  it('strips alphabetic characters', () => {
    expect(sanitizeAmountInput('1e5')).toBe('15');
    expect(sanitizeAmountInput('100abc')).toBe('100');
  });

  it('strips negative sign', () => {
    expect(sanitizeAmountInput('-100')).toBe('100');
  });

  it('removes extra decimal points', () => {
    expect(sanitizeAmountInput('1.2.3')).toBe('1.2');
    // "..5" — regex captures up to and including the first dot, second dot
    // stops the digit run, so result is "." (effectively 0 — the UI will
    // treat this as an empty / invalid entry).
    expect(sanitizeAmountInput('..5')).toBe('.');
  });

  it('returns empty string for fully non-numeric input', () => {
    expect(sanitizeAmountInput('abc')).toBe('');
  });

  it('allows a leading decimal point (user is typing "0.5")', () => {
    expect(sanitizeAmountInput('.5')).toBe('.5');
  });

  it('handles empty string', () => {
    expect(sanitizeAmountInput('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// inputToMib
// ---------------------------------------------------------------------------

describe('inputToMib', () => {
  it('returns 0 for empty string', () => {
    expect(inputToMib('', 'MB')).toBe(0);
  });

  it('returns 0 for "0"', () => {
    expect(inputToMib('0', 'GB')).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(inputToMib('-5', 'MB')).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    expect(inputToMib('abc', 'MB')).toBe(0);
  });

  it('converts MB value to MiB (1:1)', () => {
    expect(inputToMib('10', 'MB')).toBe(10);
    expect(inputToMib('512', 'MB')).toBe(512);
  });

  it('converts GB value to MiB (×1024)', () => {
    expect(inputToMib('1', 'GB')).toBe(1024);
    expect(inputToMib('2', 'GB')).toBe(2048);
    expect(inputToMib('0.5', 'GB')).toBe(512);
  });

  it('converts TB value to MiB (×1048576)', () => {
    expect(inputToMib('1', 'TB')).toBe(1024 * 1024);
    expect(inputToMib('0.5', 'TB')).toBe(512 * 1024);
  });

  it('rounds fractional MiB results to the nearest integer', () => {
    // 0.1 GB = 102.4 MiB → rounds to 102
    expect(inputToMib('0.1', 'GB')).toBe(102);
  });

  it('handles large TB values without overflow', () => {
    // 100 TB = 104,857,600 MiB — well within JS safe integer range
    expect(inputToMib('100', 'TB')).toBe(100 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Round-trip unit conversion
// ---------------------------------------------------------------------------

describe('unit conversion round-trip', () => {
  it('MB → GB → MB preserves the MiB count (within rounding)', () => {
    const originalMib = 512;
    const gbDisplay = mibToDisplay(originalMib, 'GB'); // "0.5"
    const roundTrip = inputToMib(gbDisplay, 'GB');
    expect(roundTrip).toBe(originalMib);
  });

  it('GB → TB → GB preserves the MiB count for round values', () => {
    const originalMib = 2 * 1024; // 2 GiB
    const tbDisplay = mibToDisplay(originalMib, 'TB'); // "0.001953" or similar
    const roundTrip = inputToMib(tbDisplay, 'TB');
    // Allow ±1 MiB due to toPrecision(4) rounding
    expect(Math.abs(roundTrip - originalMib)).toBeLessThanOrEqual(1);
  });

  it('1 TB round-trips exactly', () => {
    const originalMib = 1024 * 1024;
    const tbDisplay = mibToDisplay(originalMib, 'TB'); // "1"
    expect(inputToMib(tbDisplay, 'TB')).toBe(originalMib);
  });
});

// ---------------------------------------------------------------------------
// isCustomAmountOverCap
// ---------------------------------------------------------------------------

describe('isCustomAmountOverCap', () => {
  it('returns false when maxPurchasableBytes is null', () => {
    expect(isCustomAmountOverCap(100, null)).toBe(false);
  });

  it('returns false when requestedMib is 0', () => {
    expect(isCustomAmountOverCap(0, BigInt(1024 * 1024))).toBe(false);
  });

  it('returns false when requested bytes fit within the cap', () => {
    const cap = BigInt(10 * 1024 * 1024); // 10 MiB cap
    expect(isCustomAmountOverCap(5, cap)).toBe(false);
  });

  it('returns false when requested bytes exactly equal the cap', () => {
    const cap = BigInt(10 * 1024 * 1024); // exactly 10 MiB
    expect(isCustomAmountOverCap(10, cap)).toBe(false);
  });

  it('returns true when requested bytes exceed the cap by 1 byte', () => {
    const cap = BigInt(10 * 1024 * 1024) - BigInt(1); // 1 byte short of 10 MiB
    expect(isCustomAmountOverCap(10, cap)).toBe(true);
  });

  it('returns true when requested is much larger than the cap', () => {
    const cap = BigInt(1024 * 1024); // 1 MiB cap
    expect(isCustomAmountOverCap(1024, cap)).toBe(true); // 1 GiB requested
  });

  it('handles large TiB-scale values correctly', () => {
    // cap = 5 TiB in bytes
    const cap = BigInt(5) * BigInt(1024) * BigInt(1024) * BigInt(1024 * 1024);
    const fiveTibMib = 5 * 1024 * 1024;
    expect(isCustomAmountOverCap(fiveTibMib, cap)).toBe(false);
    expect(isCustomAmountOverCap(fiveTibMib + 1, cap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computePaymentShannons
// ---------------------------------------------------------------------------

describe('computePaymentShannons', () => {
  it('returns 0n when sizeMib is 0', () => {
    expect(computePaymentShannons(0, BigInt(100))).toBe(BigInt(0));
  });

  it('returns 0n when shannonsPerByte is undefined', () => {
    expect(computePaymentShannons(10, undefined)).toBe(BigInt(0));
  });

  it('returns 0n when shannonsPerByte is 0n', () => {
    expect(computePaymentShannons(10, BigInt(0))).toBe(BigInt(0));
  });

  it('computes payment correctly for 1 MiB at 1 shannon/byte', () => {
    // 1 MiB = 1,048,576 bytes × 1 shannon/byte = 1,048,576 shannons
    expect(computePaymentShannons(1, BigInt(1))).toBe(BigInt(1024 * 1024));
  });

  it('computes payment correctly for 10 MB at a realistic rate', () => {
    // Roughly 1e12 shannons per byte is a plausible AI3 rate
    const shannonsPerByte = BigInt('1000000000000'); // 1e12
    const sizeMib = 10;
    const expected = BigInt(10) * BigInt(1024 * 1024) * shannonsPerByte;
    expect(computePaymentShannons(sizeMib, shannonsPerByte)).toBe(expected);
  });

  it('matches the formula: sizeMib × 1,048,576 × shannonsPerByte', () => {
    const shannonsPerByte = BigInt('5000000000'); // 5e9
    const sizeMib = 1024; // 1 GiB
    const expected =
      BigInt(1024) * BigInt(1024 * 1024) * BigInt('5000000000');
    expect(computePaymentShannons(sizeMib, shannonsPerByte)).toBe(expected);
  });

  it('handles 1 TB (1,048,576 MiB) without overflow', () => {
    const shannonsPerByte = BigInt(1);
    const oneTibMib = 1024 * 1024;
    const expected = BigInt(oneTibMib) * BigInt(1024 * 1024);
    expect(computePaymentShannons(oneTibMib, shannonsPerByte)).toBe(expected);
  });

  it('is consistent with the usePrices formatCreditsInMbAsValue formula', () => {
    // usePrices: BigInt(creditsInMb * BYTES_PER_MiB) * BigInt(shannonsPerByte)
    // Our formula: BigInt(sizeMib) * BigInt(1024*1024) * shannonsPerByte
    // They are equivalent; verify for a concrete value.
    const shannonsPerByte = BigInt('3500000000'); // 3.5e9
    const sizeMib = 256;
    const BYTES_PER_MiB = 1024 ** 2;
    const fromUsePrices = BigInt(sizeMib * BYTES_PER_MiB) * shannonsPerByte;
    expect(computePaymentShannons(sizeMib, shannonsPerByte)).toBe(fromUsePrices);
  });
});

/**
 * Pure utility functions for the purchase-credits custom-amount UX.
 * Extracted so they can be unit-tested without a React environment.
 *
 * All internal sizes use MiB. We treat MB=MiB, GB=GiB, TB=TiB to match the
 * existing package definitions (e.g. the "1GB" preset = 1,024 MiB).
 */

// ---------------------------------------------------------------------------
// Unit definitions
// ---------------------------------------------------------------------------

export const UNITS = ['MB', 'GB', 'TB'] as const;
export type Unit = (typeof UNITS)[number];

/** Multiplier from the given unit to MiB. */
export const MIB_PER_UNIT: Record<Unit, number> = {
  MB: 1,
  GB: 1024,
  TB: 1024 * 1024,
};

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

/**
 * Pick the most human-readable unit for a given MiB value.
 * 0 / negative values fall back to MB.
 */
export const bestUnit = (mib: number): Unit => {
  if (mib >= MIB_PER_UNIT.TB) return 'TB';
  if (mib >= MIB_PER_UNIT.GB) return 'GB';
  return 'MB';
};

/**
 * Convert a MiB value to the display string in a given unit, trimmed to 4
 * significant figures with no trailing zeros.
 * Returns '' for non-positive values.
 */
export const mibToDisplay = (mib: number, unit: Unit): string => {
  if (mib <= 0) return '';
  const val = mib / MIB_PER_UNIT[unit];
  return parseFloat(val.toPrecision(4)).toString();
};

// ---------------------------------------------------------------------------
// Input sanitisation
// ---------------------------------------------------------------------------

/**
 * Sanitise a raw string from a numeric text input:
 * - Strips any character that is not a digit or decimal point.
 * - Collapses multiple decimal points, keeping only the first.
 * - Preserves at most one leading digit (no "007" style leading zeros except
 *   when the value starts with "0.").
 *
 * Returns the sanitised string (may be empty).
 */
export const sanitizeAmountInput = (raw: string): string =>
  raw.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1');

// ---------------------------------------------------------------------------
// MiB conversion
// ---------------------------------------------------------------------------

/**
 * Convert a sanitised input string + unit into whole MiB.
 * Returns 0 for any non-positive or non-finite value.
 */
export const inputToMib = (value: string, unit: Unit): number => {
  const num = parseFloat(value);
  if (!isFinite(num) || num <= 0) return 0;
  return Math.round(num * MIB_PER_UNIT[unit]);
};

// ---------------------------------------------------------------------------
// Cap validation — re-exported from credits.ts to keep a single implementation
// ---------------------------------------------------------------------------

export { isMibOverCap as isCustomAmountOverCap } from './credits';

/**
 * Pure utility functions for the purchase-credits custom-amount UX.
 * Extracted so they can be unit-tested without a React environment.
 *
 * All internal sizes use MiB (2^20 bytes).  The unit toggle displays the
 * familiar consumer labels MB / GB / TB, but uses binary multipliers
 * throughout (matching how Windows, most consumer software, and the rest
 * of this codebase count storage):
 *   1 "GB" here = 1,024 MB = 1,024 MiB
 *   1 "TB" here = 1,024 GB = 1,048,576 MiB
 */

// ---------------------------------------------------------------------------
// Unit definitions
// ---------------------------------------------------------------------------

export const UNITS = ['MB', 'GB', 'TB'] as const;
export type Unit = (typeof UNITS)[number];

/** Multiplier from the displayed unit label to MiB (binary). */
export const MIB_PER_UNIT: Record<Unit, number> = {
  MB: 1,
  GB: 1024,           // 1 "GB" = 1,024 MiB
  TB: 1024 * 1024,    // 1 "TB" = 1,048,576 MiB
};

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

/**
 * Pick the most human-readable IEC unit for a given MiB value.
 * 0 / negative values fall back to MiB.
 */
export const bestUnit = (mib: number): Unit => {
  if (mib >= MIB_PER_UNIT.TB) return 'TB';
  if (mib >= MIB_PER_UNIT.GB) return 'GB';
  return 'MB';
};

/**
 * Convert a MiB value to the display string in a given IEC unit, trimmed to
 * 4 significant figures with no trailing zeros.
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
 * - Negative signs are stripped (result is treated as 0 / invalid by the
 *   caller — inputToMib returns 0 for non-positive values).
 *
 * Returns the sanitised string (may be empty).
 */
export const sanitizeAmountInput = (raw: string): string =>
  raw.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1');

// ---------------------------------------------------------------------------
// MiB conversion
// ---------------------------------------------------------------------------

/**
 * Convert a sanitised input string + IEC unit into whole MiB.
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

/**
 * Byte amounts admins type in MB, GB or TB. Binary, as the app counts storage
 * and credits everywhere (1 GB = 1,024 MB), so an amount reads back as it was
 * typed.
 */
export const BYTE_UNITS = {
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
} as const;

export type ByteUnit = keyof typeof BYTE_UNITS;

/**
 * The amount in whole bytes, or null when it is empty, negative, not a number
 * or too large to count exactly.
 */
export const amountToBytes = (
  amount: string,
  unit: ByteUnit,
): number | null => {
  if (amount.trim() === '') return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  const bytes = Math.round(value * BYTE_UNITS[unit]);
  return Number.isSafeInteger(bytes) ? bytes : null;
};

/**
 * A form's starting value for `bytes`: the largest unit it is at least 1 of
 * with at most 3 decimals, else MB. The units are powers of 2, so the amount
 * is exact and saving an untouched form changes nothing.
 */
export const bytesToAmount = (
  bytes: number,
): { amount: string; unit: ByteUnit } => {
  for (const unit of ['TB', 'GB'] as const) {
    const amount = String(bytes / BYTE_UNITS[unit]);
    if (bytes >= BYTE_UNITS[unit] && !/\.\d{4,}/.test(amount)) {
      return { amount, unit };
    }
  }
  return { amount: String(bytes / BYTE_UNITS.MB), unit: 'MB' };
};

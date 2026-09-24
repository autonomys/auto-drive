import bytes from 'bytes';

// Format number with commas
export const formatNumberWithCommas = (num?: number | null): string => {
  if (num === undefined || num === null || Number.isNaN(num)) return 'N/A';
  if (!Number.isFinite(num)) return num.toString();
  const [integerPart, decimalPart] = num.toString().split('.');
  const formattedInt = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimalPart !== undefined ? `${formattedInt}.${decimalPart}` : formattedInt;
};

export const truncateNumberWithDecimals = (
  num: number,
  decimals: number = 2,
): number => {
  if (Number.isNaN(num) || !Number.isFinite(num)) return num;
  const safeDecimals = Math.max(0, Math.floor(decimals));
  const precision = 10 ** safeDecimals;
  return Math.trunc(num * precision) / precision;
};

const mappers = {
  ['EB']: 'EiB',
  ['PB']: 'PiB',
  ['TB']: 'TiB',
  ['GB']: 'GiB',
  ['MB']: 'MiB',
  ['KB']: 'KiB',
};

// Map XB to XiB since 'bytes' library uses XB when it should be XiB
export const formatBytes = (
  amount: number,
  decimalPlaces: number = 2,
): string => {
  if (typeof amount !== 'number' || Number.isNaN(amount) || !Number.isFinite(amount)) return 'N/A';
  const formatted = bytes(amount, { decimalPlaces });
  if (!formatted) return 'N/A';

  return formatted.replaceAll(
    /(EB|PB|TB|GB|MB|KB)/g,
    (match) => mappers[match as keyof typeof mappers],
  );
};

/**
 * Format a byte count for user-facing display using the familiar consumer
 * labels (MB / GB / TB).  Scaling is binary (1 GB = 1,024 MB), matching how
 * the rest of the app counts storage and credits — but unlike `formatBytes`
 * the labels are kept as MB/GB/TB rather than relabeled to MiB/GiB, so users
 * don't have to care about the binary detail under the hood.
 */
export const formatStorageSize = (
  amount: number,
  decimalPlaces: number = 2,
): string => {
  if (typeof amount !== 'number' || Number.isNaN(amount) || !Number.isFinite(amount)) return 'N/A';
  const formatted = bytes(amount, { decimalPlaces, unitSeparator: ' ' });
  if (!formatted) return 'N/A';

  return formatted;
};

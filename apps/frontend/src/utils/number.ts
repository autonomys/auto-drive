import bytes from 'bytes';

// Format number with commas
export const formatNumberWithCommas = (num?: number): string => {
  if (num === undefined) return 'N/A';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const truncateNumberWithDecimals = (
  num: number,
  decimals: number = 2,
): number => {
  const precision = 10 ** decimals;
  return Math.floor(num * precision) / precision;
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
  const formatted = bytes(amount, { decimalPlaces });
  if (!formatted) return 'N/A';

  return formatted.replaceAll(
    /(EB|PB|TB|GB|MB|KB)/g,
    (match) => mappers[match as keyof typeof mappers],
  );
};

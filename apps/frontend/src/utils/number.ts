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

export const truncateBytes = (num: number): string => {
  const f = bytes(num, { decimalPlaces: 2 });
  if (!f) return 'N/A';

  // Extract the numeric part and unit using regex
  const match = f.match(/^(\d+(?:\.\d+)?)([KMGT]?B)$/);
  if (!match) return f;

  const [, numericPart, unit] = match;

  // If it contains a decimal point, truncate to integer
  if (numericPart.includes('.')) {
    const integerPart = numericPart.split('.')[0];
    return `${integerPart}${unit}`;
  }

  return f;
};

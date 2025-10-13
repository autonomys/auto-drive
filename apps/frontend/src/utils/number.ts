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

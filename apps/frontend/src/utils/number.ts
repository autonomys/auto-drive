// Format number with commas
export const formatNumberWithCommas = (num?: number): string => {
    if (num === undefined) return 'N/A';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
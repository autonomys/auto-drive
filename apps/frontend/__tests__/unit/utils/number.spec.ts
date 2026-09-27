import {
  formatBytes,
  formatNumberWithCommas,
  formatStorageSize,
  truncateNumberWithDecimals,
} from '../../../src/utils/number';

describe('number utils', () => {
  describe('formatNumberWithCommas', () => {
    it('formats positive integers with comma grouping', () => {
      expect(formatNumberWithCommas(1000)).toBe('1,000');
      expect(formatNumberWithCommas(1234567)).toBe('1,234,567');
      expect(formatNumberWithCommas(1000000000)).toBe('1,000,000,000');
    });

    it('returns small numbers without commas', () => {
      expect(formatNumberWithCommas(0)).toBe('0');
      expect(formatNumberWithCommas(42)).toBe('42');
      expect(formatNumberWithCommas(999)).toBe('999');
    });

    it('formats negative numbers with comma grouping', () => {
      expect(formatNumberWithCommas(-1000)).toBe('-1,000');
      expect(formatNumberWithCommas(-1234567)).toBe('-1,234,567');
    });

    it('formats numbers with decimal fractions without corrupting fractional digits', () => {
      expect(formatNumberWithCommas(1234.5678)).toBe('1,234.5678');
      expect(formatNumberWithCommas(-1234.5678)).toBe('-1,234.5678');
      expect(formatNumberWithCommas(1000000.123456)).toBe('1,000,000.123456');
    });

    it('returns N/A for null, undefined, and NaN', () => {
      expect(formatNumberWithCommas(undefined)).toBe('N/A');
      expect(formatNumberWithCommas(null)).toBe('N/A');
      expect(formatNumberWithCommas(NaN)).toBe('N/A');
    });
  });

  describe('truncateNumberWithDecimals', () => {
    it('truncates positive floating-point numbers to specified decimals', () => {
      expect(truncateNumberWithDecimals(1.23456, 2)).toBe(1.23);
      expect(truncateNumberWithDecimals(1.9999, 2)).toBe(1.99);
      expect(truncateNumberWithDecimals(10.555, 1)).toBe(10.5);
    });

    it('defaults to 2 decimal places', () => {
      expect(truncateNumberWithDecimals(3.14159)).toBe(3.14);
      expect(truncateNumberWithDecimals(5.6789)).toBe(5.67);
    });

    it('truncates negative floating-point numbers towards zero', () => {
      expect(truncateNumberWithDecimals(-1.236, 2)).toBe(-1.23);
      expect(truncateNumberWithDecimals(-9.999, 1)).toBe(-9.9);
    });

    it('handles 0 decimals correctly', () => {
      expect(truncateNumberWithDecimals(4.99, 0)).toBe(4);
      expect(truncateNumberWithDecimals(-4.99, 0)).toBe(-4);
    });

    it('safely handles non-finite numbers', () => {
      expect(truncateNumberWithDecimals(NaN, 2)).toBe(0);
      expect(truncateNumberWithDecimals(Infinity, 2)).toBe(0);
      expect(truncateNumberWithDecimals(-Infinity, 2)).toBe(0);
    });

    it('avoids floating-point multiplication rounding errors on prone values', () => {
      expect(truncateNumberWithDecimals(1.14, 2)).toBe(1.14);
      expect(truncateNumberWithDecimals(-1.14, 2)).toBe(-1.14);
      expect(truncateNumberWithDecimals(1.145, 2)).toBe(1.14);
    });
  });

  describe('formatBytes', () => {
    it('formats bytes with binary units and XiB notation', () => {
      expect(formatBytes(0)).toBe('0B');
      expect(formatBytes(1024)).toBe('1KiB');
      expect(formatBytes(1024 * 1024)).toBe('1MiB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1GiB');
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1TiB');
    });

    it('respects decimalPlaces parameter', () => {
      expect(formatBytes(1536, 1)).toBe('1.5KiB');
      expect(formatBytes(1536, 0)).toBe('2KiB');
    });

    it('returns N/A for invalid or non-finite inputs', () => {
      expect(formatBytes(NaN)).toBe('N/A');
    });
  });

  describe('formatStorageSize', () => {
    it('formats storage using consumer MB/GB labels with space separator', () => {
      expect(formatStorageSize(0)).toBe('0 B');
      expect(formatStorageSize(1024)).toBe('1 KB');
      expect(formatStorageSize(1024 * 1024)).toBe('1 MB');
      expect(formatStorageSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('respects decimalPlaces parameter', () => {
      expect(formatStorageSize(1536, 1)).toBe('1.5 KB');
    });
  });
});

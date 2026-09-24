import { describe, it, expect } from '@jest/globals';
import {
  formatNumberWithCommas,
  truncateNumberWithDecimals,
  formatBytes,
  formatStorageSize,
} from '../../../src/utils/number';

describe('number utils', () => {
  describe('formatNumberWithCommas', () => {
    it('returns N/A for null, undefined, or NaN', () => {
      expect(formatNumberWithCommas(undefined)).toBe('N/A');
      expect(formatNumberWithCommas(null as unknown as number)).toBe('N/A');
      expect(formatNumberWithCommas(NaN)).toBe('N/A');
    });

    it('formats small integers without commas', () => {
      expect(formatNumberWithCommas(0)).toBe('0');
      expect(formatNumberWithCommas(42)).toBe('42');
      expect(formatNumberWithCommas(999)).toBe('999');
    });

    it('formats large integers with comma separators', () => {
      expect(formatNumberWithCommas(1000)).toBe('1,000');
      expect(formatNumberWithCommas(1234567)).toBe('1,234,567');
      expect(formatNumberWithCommas(1000000000)).toBe('1,000,000,000');
    });

    it('formats decimals without inserting commas into the decimal part', () => {
      expect(formatNumberWithCommas(1234.5678)).toBe('1,234.5678');
      expect(formatNumberWithCommas(1000000.123456)).toBe('1,000,000.123456');
    });

    it('formats negative numbers correctly', () => {
      expect(formatNumberWithCommas(-1000)).toBe('-1,000');
      expect(formatNumberWithCommas(-1234567.89)).toBe('-1,234,567.89');
    });

    it('handles non-finite values safely', () => {
      expect(formatNumberWithCommas(Infinity)).toBe('Infinity');
      expect(formatNumberWithCommas(-Infinity)).toBe('-Infinity');
    });
  });

  describe('truncateNumberWithDecimals', () => {
    it('truncates positive floating point numbers', () => {
      expect(truncateNumberWithDecimals(1.2345, 2)).toBe(1.23);
      expect(truncateNumberWithDecimals(1.2399, 2)).toBe(1.23);
      expect(truncateNumberWithDecimals(1.999, 1)).toBe(1.9);
      expect(truncateNumberWithDecimals(42.555, 0)).toBe(42);
    });

    it('truncates negative numbers towards zero without rounding down', () => {
      expect(truncateNumberWithDecimals(-1.2345, 2)).toBe(-1.23);
      expect(truncateNumberWithDecimals(-1.2399, 2)).toBe(-1.23);
      expect(truncateNumberWithDecimals(-42.9, 0)).toBe(-42);
    });

    it('defaults to 2 decimals when unspecified', () => {
      expect(truncateNumberWithDecimals(10.5678)).toBe(10.56);
    });

    it('handles NaN and non-finite values safely', () => {
      expect(truncateNumberWithDecimals(NaN)).toBeNaN();
      expect(truncateNumberWithDecimals(Infinity)).toBe(Infinity);
    });
  });

  describe('formatBytes', () => {
    it('formats bytes and maps standard XB units to XiB', () => {
      expect(formatBytes(1024)).toBe('1KiB');
      expect(formatBytes(1024 * 1024)).toBe('1MiB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1GiB');
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1TiB');
    });

    it('supports custom decimal places', () => {
      expect(formatBytes(1536, 1)).toBe('1.5KiB');
    });

    it('returns N/A for NaN, invalid numbers, or non-finite numbers', () => {
      expect(formatBytes(NaN)).toBe('N/A');
      expect(formatBytes(Infinity)).toBe('N/A');
      expect(formatBytes('invalid' as unknown as number)).toBe('N/A');
    });
  });

  describe('formatStorageSize', () => {
    it('formats sizes with space separator and consumer labels', () => {
      expect(formatStorageSize(1024 * 1024)).toBe('1 MB');
      expect(formatStorageSize(1.5 * 1024 * 1024, 1)).toBe('1.5 MB');
      expect(formatStorageSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('returns N/A for NaN, invalid numbers, or non-finite numbers', () => {
      expect(formatStorageSize(NaN)).toBe('N/A');
      expect(formatStorageSize(Infinity)).toBe('N/A');
      expect(formatStorageSize('invalid' as unknown as number)).toBe('N/A');
    });
  });
});

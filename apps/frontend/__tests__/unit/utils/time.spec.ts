import { describe, it, expect } from '@jest/globals';
import dayjs from 'dayjs';
import {
  currentYear,
  formatDate,
  formatLocalDate,
  utcToLocalRelativeTime,
  formatDateWithTimezone,
} from '../../../src/utils/time';

describe('time utils', () => {
  it('returns current year', () => {
    expect(currentYear()).toBe(new Date().getFullYear());
  });

  describe('formatDate and formatLocalDate', () => {
    it('formats valid ISO date strings in local time', () => {
      const iso = '2025-01-15T12:00:00.000Z';
      const formatted = formatDate(iso);
      expect(formatted).not.toBe('N/A');
      expect(formatted).not.toBe('Invalid Date');
      expect(formatLocalDate(iso)).toBe(formatted);
    });

    it('returns N/A for empty or invalid date strings', () => {
      expect(formatDate('')).toBe('N/A');
      expect(formatDate('not-a-valid-date')).toBe('N/A');
      expect(formatLocalDate('')).toBe('N/A');
      expect(formatLocalDate('not-a-valid-date')).toBe('N/A');
    });
  });

  describe('utcToLocalRelativeTime', () => {
    it('returns N/A for empty or invalid timestamps', () => {
      expect(utcToLocalRelativeTime('')).toBe('N/A');
      expect(utcToLocalRelativeTime('invalid-timestamp')).toBe('N/A');
    });

    it('returns just now for identical timestamp', () => {
      const now = new Date().toISOString();
      expect(utcToLocalRelativeTime(now)).toBe('just now');
    });

    it('formats recent past seconds correctly', () => {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
      const result = utcToLocalRelativeTime(thirtySecondsAgo);
      expect(result).toMatch(/^\d+ seconds ago$/);
      expect(result).not.toContain('-');
    });

    it('formats recent future seconds with positive number', () => {
      const thirtySecondsFromNow = new Date(Date.now() + 30 * 1000).toISOString();
      const result = utcToLocalRelativeTime(thirtySecondsFromNow);
      expect(result).toMatch(/^\d+ seconds from now$/);
      expect(result).not.toContain('-');
    });

    it('formats past intervals over a minute', () => {
      const fiveMinutesAgo = dayjs().subtract(5, 'minute').toISOString();
      const result = utcToLocalRelativeTime(fiveMinutesAgo);
      expect(result).toContain('ago');
    });

    it('formats future intervals over a minute', () => {
      const twoHoursFromNow = dayjs().add(2, 'hour').toISOString();
      const result = utcToLocalRelativeTime(twoHoursFromNow);
      expect(result).toContain('from now');
      expect(result).not.toContain('-');
    });
  });

  describe('formatDateWithTimezone', () => {
    it('includes timezone in output for valid dates', () => {
      const iso = '2025-06-01T10:00:00.000Z';
      const formatted = formatDateWithTimezone(iso);
      expect(formatted).not.toBe('N/A');
      expect(formatted).toContain('(');
      expect(formatted).toContain(')');
    });

    it('returns N/A for invalid dates', () => {
      expect(formatDateWithTimezone('')).toBe('N/A');
      expect(formatDateWithTimezone('invalid')).toBe('N/A');
    });
  });
});

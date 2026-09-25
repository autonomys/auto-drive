/**
 * @jest-environment jsdom
 */
/* eslint-disable camelcase, @typescript-eslint/no-explicit-any */
import { describe, expect, it, jest } from '@jest/globals';
import { Order_By } from 'gql/graphql';
import {
  DEFAULT_PAGE_PARAM_INTERNAL,
  DEFAULT_PAGE_PARAM_UI,
} from '../../../src/constants/table';
import {
  formatCid,
  getDisplayPageNumber,
  getInternalPageNumber,
  getTotalPages,
  resetParams,
  updateSortParams,
  updateUrlParams,
} from '../../../src/utils/table';

describe('table utilities', () => {
  describe('formatCid', () => {
    it('returns empty string for falsy input', () => {
      expect(formatCid('')).toBe('');
      // @ts-expect-error testing runtime robustness
      expect(formatCid(null)).toBe('');
      // @ts-expect-error testing runtime robustness
      expect(formatCid(undefined)).toBe('');
    });

    it('returns untouched string if length is 15 or less', () => {
      expect(formatCid('bafy123')).toBe('bafy123');
      expect(formatCid('123456789012345')).toBe('123456789012345');
    });

    it('truncates strings longer than 15 characters with ellipsis', () => {
      const longCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const formatted = formatCid(longCid);
      expect(formatted).toBe('bafybeigdy...fbzdi');
      expect(formatted.slice(0, 10)).toBe(longCid.slice(0, 10));
      expect(formatted.slice(-5)).toBe(longCid.slice(-5));
    });
  });

  describe('getDisplayPageNumber', () => {
    it('converts 0-based internal page to 1-based display page string', () => {
      expect(getDisplayPageNumber(0)).toBe('1');
      expect(getDisplayPageNumber(1)).toBe('2');
      expect(getDisplayPageNumber(9)).toBe('10');
    });

    it('falls back to default UI page when internal page is negative', () => {
      expect(getDisplayPageNumber(-1)).toBe(DEFAULT_PAGE_PARAM_UI.toString());
      expect(getDisplayPageNumber(-10)).toBe(DEFAULT_PAGE_PARAM_UI.toString());
    });
  });

  describe('getInternalPageNumber', () => {
    it('converts 1-based display page to 0-based internal page string', () => {
      expect(getInternalPageNumber(1)).toBe('0');
      expect(getInternalPageNumber(2)).toBe('1');
      expect(getInternalPageNumber(10)).toBe('9');
    });

    it('falls back to default internal page when display page is less than 1', () => {
      expect(getInternalPageNumber(0)).toBe(DEFAULT_PAGE_PARAM_INTERNAL.toString());
      expect(getInternalPageNumber(-1)).toBe(DEFAULT_PAGE_PARAM_INTERNAL.toString());
    });
  });

  describe('getTotalPages', () => {
    it('returns 1 when total or limit is zero or negative', () => {
      expect(getTotalPages(0, 10)).toBe(1);
      expect(getTotalPages(-5, 10)).toBe(1);
      expect(getTotalPages(100, 0)).toBe(1);
      expect(getTotalPages(100, -10)).toBe(1);
    });

    it('calculates total pages using ceiling division', () => {
      expect(getTotalPages(1, 10)).toBe(1);
      expect(getTotalPages(10, 10)).toBe(1);
      expect(getTotalPages(11, 10)).toBe(2);
      expect(getTotalPages(25, 10)).toBe(3);
      expect(getTotalPages(100, 20)).toBe(5);
    });
  });

  describe('updateUrlParams', () => {
    it('updates page and limit params while preserving existing query params', () => {
      const mockReplace = jest.fn();
      const mockRouter = { replace: mockReplace } as any;
      const initialParams = new URLSearchParams('search=test&filter=active');

      updateUrlParams('/files', initialParams, 2, 20, mockRouter);

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(
        '/files?search=test&filter=active&page=3&limit=20',
        { scroll: false },
      );
    });
  });

  describe('updateSortParams', () => {
    it('updates sortKey and sortOrder and resets page to 1', () => {
      const mockReplace = jest.fn();
      const mockRouter = { replace: mockReplace } as any;
      const initialParams = new URLSearchParams('page=5&limit=10&search=doc');

      updateSortParams(
        '/files',
        initialParams,
        'size',
        Order_By.AscNullsFirst,
        mockRouter,
      );

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(
        '/files?page=1&limit=10&search=doc&sortKey=size&sortOrder=asc_nulls_first',
        { scroll: false },
      );
    });
  });

  describe('resetParams', () => {
    it('removes pagination and sorting query parameters from history state', () => {
      const originalReplaceState = window.history.replaceState;
      const mockReplaceState = jest.fn();
      window.history.replaceState = mockReplaceState as any;

      delete (window as any).location;
      (window as any).location = new URL('https://example.com/files?page=2&limit=20&sortKey=name&sortOrder=Asc&other=value');

      resetParams();

      expect(mockReplaceState).toHaveBeenCalledTimes(1);
      const updatedUrl = mockReplaceState.mock.calls[0][2] as URL;
      expect(updatedUrl.searchParams.has('page')).toBe(false);
      expect(updatedUrl.searchParams.has('limit')).toBe(false);
      expect(updatedUrl.searchParams.has('sortKey')).toBe(false);
      expect(updatedUrl.searchParams.has('sortOrder')).toBe(false);
      expect(updatedUrl.searchParams.get('other')).toBe('value');

      window.history.replaceState = originalReplaceState;
    });
  });
});

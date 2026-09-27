import {
  isValidUUID,
  shortenString,
  simpleMimeType,
} from '../../../src/utils/misc';

describe('misc utils', () => {
  describe('shortenString', () => {
    it('returns original string when length is within limit', () => {
      expect(shortenString('hello', 10)).toBe('hello');
      expect(shortenString('exact-length', 12)).toBe('exact-length');
    });

    it('shortens string with ellipsis in the middle when exceeding length', () => {
      const result = shortenString('abcdefghij', 6);
      expect(result).toBe('abc...hij');
      expect(result.includes('...')).toBe(true);
    });

    it('handles odd target lengths with integer indexing', () => {
      const result = shortenString('abcdefghij', 5);
      // half = Math.floor(5/2) = 2 -> 'ab...ij'
      expect(result).toBe('ab...ij');
    });

    it('handles empty, null, or undefined strings safely', () => {
      expect(shortenString('')).toBe('');
      expect(shortenString(null)).toBe('');
      expect(shortenString(undefined)).toBe('');
    });

    it('handles non-positive lengths safely', () => {
      expect(shortenString('hello', 0)).toBe('');
      expect(shortenString('hello', -5)).toBe('');
    });

    it('defaults length to 20 when not specified', () => {
      expect(shortenString('short')).toBe('short');
      const longStr = 'abcdefghijklmnopqrstuvwxyz';
      expect(shortenString(longStr)).toBe('abcdefghij...qrstuvwxyz');
    });
  });

  describe('isValidUUID', () => {
    it('validates standard UUIDs correctly', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(isValidUUID('A987FBC9-4BED-3078-CF07-9141BA07C9F3')).toBe(true);
      expect(isValidUUID('c88019a3-5c54-4632-a5e0-82d23c8a9947')).toBe(true);
    });

    it('rejects invalid or malformed strings', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('123e4567-e89b-12d3-a456')).toBe(false);
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000-extra')).toBe(false);
      expect(isValidUUID('123e4567-e89b-12d3-a456-42661417400z')).toBe(false);
    });

    it('handles null, undefined, and non-string inputs safely', () => {
      expect(isValidUUID(null)).toBe(false);
      expect(isValidUUID(undefined)).toBe(false);
      expect(isValidUUID('')).toBe(false);
      expect(isValidUUID(123 as any)).toBe(false);
    });
  });

  describe('simpleMimeType', () => {
    it('extracts primary type from valid MIME types', () => {
      expect(simpleMimeType('image/png')).toBe('image');
      expect(simpleMimeType('application/json')).toBe('application');
      expect(simpleMimeType('text/plain')).toBe('text');
      expect(simpleMimeType('video/mp4')).toBe('video');
    });

    it('handles MIME type without slash', () => {
      expect(simpleMimeType('octet-stream')).toBe('octet-stream');
    });

    it('handles null, undefined, and non-string values safely without throwing', () => {
      expect(simpleMimeType(null)).toBe('');
      expect(simpleMimeType(undefined)).toBe('');
      expect(simpleMimeType('')).toBe('');
      expect(simpleMimeType(123 as any)).toBe('');
    });
  });
});

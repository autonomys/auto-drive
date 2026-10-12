import { sanitizeCallbackUrl } from '../../../src/utils/callbackUrl';

describe('sanitizeCallbackUrl', () => {
  it.each([
    ['/mainnet/drive/developers', '/mainnet/drive/developers'],
    [
      '/mainnet/drive/developers?newKey=app#x',
      '/mainnet/drive/developers?newKey=app#x',
    ],
    ['/mainnet/./drive', '/mainnet/drive'],
  ])('keeps same-origin path %s', (raw, expected) => {
    expect(sanitizeCallbackUrl(raw)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.com',
    'evil.com',
    '//evil.com',
    '/\\evil.com',
    '/.//evil.com',
    '/..//evil.com',
    '/./\\evil.com',
    '/%2e//evil.com',
  ])('rejects %p', (raw) => {
    expect(sanitizeCallbackUrl(raw)).toBeNull();
  });
});

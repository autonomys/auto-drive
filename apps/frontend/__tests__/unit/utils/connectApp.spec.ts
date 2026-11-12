import {
  DEFAULT_CONNECT_EXPIRY_DAYS,
  DEFAULT_EXPIRY_PRESET,
  MAX_APP_NAME_LENGTH,
  MAX_STATE_LENGTH,
  buildConnectCancelRedirect,
  buildConnectErrorRedirect,
  buildConnectSuccessRedirect,
  expiryPresetToIso,
  parseConnectAppName,
  parseConnectState,
  parseExtensionRedirectUri,
} from '../../../src/utils/connectApp';

describe('connectApp utils', () => {
  describe('parseConnectAppName', () => {
    it('trims and returns valid app names', () => {
      expect(parseConnectAppName('  Auto Drive Extension  ')).toBe(
        'Auto Drive Extension',
      );
      expect(parseConnectAppName(['First App', 'Second App'])).toBe(
        'First App',
      );
    });

    it('truncates app names exceeding MAX_APP_NAME_LENGTH', () => {
      const longName = 'a'.repeat(MAX_APP_NAME_LENGTH + 20);
      expect(parseConnectAppName(longName)).toBe(
        'a'.repeat(MAX_APP_NAME_LENGTH),
      );
    });

    it.each([null, undefined, '', '   ', []])('rejects %p', (raw) => {
      expect(parseConnectAppName(raw)).toBeNull();
    });
  });

  describe('parseConnectState', () => {
    it('returns valid state strings within length limit', () => {
      expect(parseConnectState('random-csrf-token-123')).toEqual({
        valid: true,
        value: 'random-csrf-token-123',
      });
      expect(parseConnectState(['state-1', 'state-2'])).toEqual({
        valid: true,
        value: 'state-1',
      });
    });

    it('distinguishes absent state from invalid state', () => {
      expect(parseConnectState(null)).toEqual({ valid: true, value: null });
      expect(parseConnectState(undefined)).toEqual({
        valid: true,
        value: null,
      });
      expect(parseConnectState('')).toEqual({ valid: true, value: null });

      expect(parseConnectState('x'.repeat(MAX_STATE_LENGTH + 1))).toEqual({
        valid: false,
        value: null,
      });
    });
  });

  describe('parseExtensionRedirectUri', () => {
    it('accepts valid Chromium extension redirect URLs and extracts extensionId', () => {
      const extId = 'abcdefghijklmnopabcdefghijklmnop';
      const result = parseExtensionRedirectUri(
        `https://${extId}.chromiumapp.org/cb`,
      );
      expect(result).toEqual({
        redirectUri: `https://${extId}.chromiumapp.org/cb`,
        extensionId: extId,
        browser: 'chromium',
      });
    });

    it('accepts valid Firefox extension redirect URLs and extracts extensionId', () => {
      const hash = '7b3f9d1a-0c2e-4f8b-9a1d-3e5f7a9b1c2d';
      const result = parseExtensionRedirectUri(
        `https://${hash}.extensions.allizom.org/`,
      );
      expect(result).toEqual({
        redirectUri: `https://${hash}.extensions.allizom.org/`,
        extensionId: hash,
        browser: 'firefox',
      });
    });

    it.each([
      null,
      undefined,
      '',
      'not-a-url',
      // Non-HTTPS schemes
      'http://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/cb',
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/cb.html',
      'javascript:alert(1)',
      // Non-allowlisted origins & lookalike domains
      'https://evil.com/cb',
      'https://chromiumapp.org/cb',
      'https://extensions.allizom.org/cb',
      'https://allizom.org/cb',
      'https://abc.chromiumapp.org.evil.com/cb',
      'https://evil.com/https://abc.chromiumapp.org/cb',
      // Nested subdomains
      'https://sub.abc.chromiumapp.org/cb',
      'https://sub.abc.extensions.allizom.org/cb',
      // Invalid leading/trailing hyphens in Firefox host label
      'https://-abc.extensions.allizom.org/cb',
      'https://abc-.extensions.allizom.org/cb',
      // Embedded credentials, non-default ports, or pre-existing fragments
      'https://user:pass@abc.chromiumapp.org/cb',
      'https://abc.chromiumapp.org:8443/cb',
      'https://abc.chromiumapp.org/cb#existing',
      'https://abc.chromiumapp.org/cb#',
    ])('rejects disallowed redirect_uri %p', (raw) => {
      expect(parseExtensionRedirectUri(raw)).toBeNull();
    });
  });

  describe('fragment redirect builders', () => {
    const redirectUri =
      'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/cb';

    it('builds success redirect with URL-encoded api_key and optional state in fragment', () => {
      expect(
        buildConnectSuccessRedirect(redirectUri, 'secret_key_123', 'state abc'),
      ).toBe(`${redirectUri}#api_key=secret_key_123&state=state+abc`);

      expect(
        buildConnectSuccessRedirect(redirectUri, 'secret_key_123', null),
      ).toBe(`${redirectUri}#api_key=secret_key_123`);
    });

    it('builds error redirect with invalid_request or access_denied and optional state', () => {
      expect(
        buildConnectErrorRedirect(redirectUri, 'invalid_request', 'csrf-state'),
      ).toBe(`${redirectUri}#error=invalid_request&state=csrf-state`);

      expect(
        buildConnectCancelRedirect(redirectUri, 'csrf-state'),
      ).toBe(`${redirectUri}#error=access_denied&state=csrf-state`);

      expect(buildConnectCancelRedirect(redirectUri, null)).toBe(
        `${redirectUri}#error=access_denied`,
      );
    });
  });

  describe('expiryPresetToIso', () => {
    it('converts presets to ISO dates and respects DEFAULT_CONNECT_EXPIRY_DAYS', () => {
      expect(expiryPresetToIso('never')).toBeNull();
      expect(DEFAULT_EXPIRY_PRESET).toBe('90d');

      const iso90 = expiryPresetToIso('90d');
      expect(iso90).toBeTruthy();
      const diffDays = Math.round(
        (new Date(iso90!).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(DEFAULT_CONNECT_EXPIRY_DAYS);
    });
  });
});

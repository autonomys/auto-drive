// Helpers for the `/[chain]/drive/connect` browser-extension consent flow.
//
// API keys have no scopes and grant full access to the user's account, so
// `redirect_uri` is strictly allowlisted to browser-extension identity redirect
// origins (`https://<ext-id>.chromiumapp.org/*` and
// `https://<hash>.extensions.allizom.org/*`). The browser intercepts redirects
// to those origins and delivers the URL (including its `#fragment`) only to the
// matching extension.

export const MAX_APP_NAME_LENGTH = 64;
export const MAX_STATE_LENGTH = 512;
export const DEFAULT_CONNECT_EXPIRY_DAYS = 90;

export type ExtensionBrowser = 'chromium' | 'firefox';

export interface ParsedExtensionRedirect {
  redirectUri: string;
  extensionId: string;
  browser: ExtensionBrowser;
}

const CHROMIUM_REDIRECT_HOST = /^([a-z0-9]+)\.chromiumapp\.org$/;
const FIREFOX_REDIRECT_HOST =
  /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.extensions\.allizom\.org$/;

const firstParam = (
  raw: string | string[] | null | undefined,
): string | null => {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
};

export const parseConnectAppName = (
  raw: string | string[] | null | undefined,
): string | null => {
  const value = firstParam(raw);
  if (!value) return null;
  const trimmed = value.trim().slice(0, MAX_APP_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
};

export const parseConnectState = (
  raw: string | string[] | null | undefined,
): string | null => {
  const value = firstParam(raw);
  if (!value || value.length > MAX_STATE_LENGTH) return null;
  return value;
};

export const parseExtensionRedirectUri = (
  raw: string | string[] | null | undefined,
): ParsedExtensionRedirect | null => {
  const value = firstParam(raw)?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  if (url.hash !== '') return null;

  const host = url.hostname.toLowerCase();

  const chromiumMatch = CHROMIUM_REDIRECT_HOST.exec(host);
  if (chromiumMatch) {
    return {
      redirectUri: url.toString(),
      extensionId: chromiumMatch[1],
      browser: 'chromium',
    };
  }

  const firefoxMatch = FIREFOX_REDIRECT_HOST.exec(host);
  if (firefoxMatch) {
    return {
      redirectUri: url.toString(),
      extensionId: firefoxMatch[1],
      browser: 'firefox',
    };
  }

  return null;
};

export const buildConnectSuccessRedirect = (
  redirectUri: string,
  apiKey: string,
  state?: string | null,
): string => {
  const fragment = new URLSearchParams();
  fragment.set('api_key', apiKey);
  if (state) fragment.set('state', state);
  return `${redirectUri}#${fragment.toString()}`;
};

export const buildConnectCancelRedirect = (
  redirectUri: string,
  state?: string | null,
): string => {
  const fragment = new URLSearchParams({ error: 'access_denied' });
  if (state) fragment.set('state', state);
  return `${redirectUri}#${fragment.toString()}`;
};

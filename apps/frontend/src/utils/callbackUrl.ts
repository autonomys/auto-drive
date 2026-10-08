// Post-login return target, carried as `?callbackUrl=` (next-auth's own
// parameter name). Only same-origin relative paths are accepted so the param
// can't be used as an open redirect.

export const CALLBACK_URL_PARAM = 'callbackUrl';

const PLACEHOLDER_ORIGIN = 'http://placeholder.invalid';

export const sanitizeCallbackUrl = (
  raw: string | null | undefined,
): string | null => {
  if (!raw || !raw.startsWith('/')) return null;
  try {
    const url = new URL(raw, PLACEHOLDER_ORIGIN);
    // Rejects protocol-relative (`//evil.com`) and backslash (`/\evil.com`)
    // forms, which resolve to a different origin.
    if (url.origin !== PLACEHOLDER_ORIGIN) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

/** Callback URL from the current page's query string, if a safe one is set. */
export const getCallbackUrlFromLocation = (): string | null =>
  typeof window === 'undefined'
    ? null
    : sanitizeCallbackUrl(
        new URLSearchParams(window.location.search).get(CALLBACK_URL_PARAM),
      );

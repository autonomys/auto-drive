/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';

const replace = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const signIn = jest.fn();
const getSession = jest.fn<() => Promise<unknown>>();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
  redirect: (url: string) => redirect(url),
}));
jest.mock('next-auth/react', () => ({ getSession: () => getSession() }));
jest.mock('../../../src/hooks/useAuth', () => ({
  useLogIn: () => ({ signIn }),
}));
jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ network: { id: 'mainnet' } }),
}));

import { useAutomaticLogin } from '../../../src/hooks/useAutomaticLogin';
import AuthenticatePage from '../../../src/app/authenticate/page';

// What `/authenticate?provider=google` redirects to (the landing page flow).
const landingSearch = () => {
  try {
    AuthenticatePage({ searchParams: { provider: 'google' } });
  } catch {
    // redirect() throws, as next/navigation's does
  }
  const url = redirect.mock.calls[0][0] as string;
  return { url, search: url.slice(url.indexOf('?')) };
};

const run = async (query: string, session: unknown) => {
  search = query;
  getSession.mockResolvedValue(session);
  renderHook(() => useAutomaticLogin());
  await waitFor(() => expect(getSession).toHaveBeenCalled());
  // let the getSession().then(...) callback run
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('/authenticate', () => {
  it('sends the provider and a My Files callback to the global feed', () => {
    const { url } = landingSearch();
    const parsed = new URL(url, 'http://x');
    expect(parsed.pathname).toBe('/mainnet/drive/global');
    expect(parsed.searchParams.get('provider')).toBe('google');
    expect(parsed.searchParams.get('callbackUrl')).toBe('/mainnet/drive');
  });
});

describe('useAutomaticLogin', () => {
  it('landing, signed in: goes to My Files', async () => {
    const { search: q } = landingSearch();
    await run(q, { user: {} });
    expect(replace).toHaveBeenCalledWith('/mainnet/drive');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('landing, signed out: signs in and returns to My Files', async () => {
    const { search: q } = landingSearch();
    await run(q, null);
    expect(signIn).toHaveBeenCalledWith('google', {
      callbackUrl: '/mainnet/drive',
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('extension link, signed in: stays on the developers page', async () => {
    // Middleware passes a signed-in request through unchanged.
    await run('?newKey=Auto%20Drive%20Extension&provider=google', { user: {} });
    expect(replace).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('extension link, signed out: signs in and returns to the dialog', async () => {
    // Middleware's redirect for a signed-out request.
    const target = '/mainnet/drive/developers?newKey=Auto+Drive+Extension';
    await run(
      `?${new URLSearchParams({ callbackUrl: target, provider: 'google' })}`,
      null,
    );
    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: target });
    expect(replace).not.toHaveBeenCalled();
  });

  it('signed out with no callback: falls back to My Files', async () => {
    await run('?provider=github', null);
    expect(signIn).toHaveBeenCalledWith('github', {
      callbackUrl: '/mainnet/drive',
    });
  });

  it('drops an unsafe callback', async () => {
    await run('?provider=google&callbackUrl=%2F.%2F%2Fevil.com', { user: {} });
    expect(replace).not.toHaveBeenCalled();
  });

  it('does nothing without a provider', async () => {
    search = '?callbackUrl=%2Fmainnet%2Fdrive';
    renderHook(() => useAutomaticLogin());
    await new Promise((r) => setTimeout(r, 0));
    expect(getSession).not.toHaveBeenCalled();
  });
});

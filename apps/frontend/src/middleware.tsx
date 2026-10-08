import { getToken, JWT } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from 'services/auth/jwt';
import { MaybeUser } from '@auto-drive/models';
import { refreshAccessToken } from './app/api/auth/[...nextauth]/jwt';
import { CALLBACK_URL_PARAM } from 'utils/callbackUrl';

const getUserFromSession = async (session: JWT) => {
  let userInfo: MaybeUser | null = await checkAuth(
    session.authProvider,
    session.accessToken,
  ).catch(() => null);

  if (
    !userInfo &&
    session.refreshToken &&
    session.authUserId &&
    session.authProvider &&
    session.accessToken
  ) {
    try {
      const newAccessToken = await refreshAccessToken({
        underlyingUserId: session.authUserId,
        underlyingProvider: session.authProvider,
        refreshToken: session.refreshToken,
      });

      if (newAccessToken) {
        userInfo = await checkAuth(
          session.authProvider,
          newAccessToken.accessToken,
        );
      }
    } catch {
      // Refresh token is stale/invalid — treat as unauthenticated
    }
  }

  return userInfo;
};

// Drive sections that need a signed-in user (the pages wrapped in
// UserProtectedLayout). `''` is the drive root, `/:chain/drive`.
const PROTECTED_DRIVE_SECTIONS = new Set([
  '',
  'admin',
  'credits',
  'developers',
  'fs',
  'profile',
  'search',
  'shared',
]);

const DRIVE_PATH = /^\/([^/]+)\/drive(?:\/([^/]+))?/;

// Signed-out visitors deep-linking into a protected drive page land on the
// global feed with the login modal open, then return to the original URL.
// A `provider` param is lifted onto the login page so the sign-in starts
// immediately instead of looping once the user is back on the original URL.
const redirectToLogin = (req: NextRequest, chain: string) => {
  const original = req.nextUrl.clone();
  const provider = original.searchParams.get('provider');
  original.searchParams.delete('provider');

  const login = new URL(`/${chain}/drive/global`, req.url);
  login.searchParams.set(
    CALLBACK_URL_PARAM,
    `${original.pathname}${original.search}`,
  );
  if (provider) login.searchParams.set('provider', provider);

  return NextResponse.redirect(login);
};

export async function middleware(req: NextRequest) {
  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const drivePath = DRIVE_PATH.exec(pathname);
  if (drivePath) {
    const [, chain, section = ''] = drivePath;
    return !session && PROTECTED_DRIVE_SECTIONS.has(section)
      ? redirectToLogin(req, chain)
      : NextResponse.next();
  }

  if (!session) {
    return NextResponse.next();
  }

  const userInfo: MaybeUser | null = await getUserFromSession(session);

  if (!userInfo) {
    return pathname !== '/'
      ? NextResponse.redirect(new URL('/', req.url))
      : NextResponse.next();
  }

  if (!userInfo.onboarded) {
    return pathname.startsWith('/onboarding')
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/onboarding', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/:chain/drive/:path*', '/', '/onboarding'],
};

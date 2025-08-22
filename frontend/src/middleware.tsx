import { getToken, JWT } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from 'services/auth/jwt';
import { MaybeUser } from '@auto-drive/models';
import { refreshAccessToken } from './app/api/auth/[...nextauth]/jwt';

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
  }

  return userInfo;
};

export async function middleware(req: NextRequest) {
  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  if (!session) {
    return pathname.startsWith('/drive')
      ? NextResponse.redirect(new URL('/', req.url), {
          headers: {
            'Set-Cookie': `redirect=${req.url}; Path=/; HttpOnly; SameSite=Strict`,
          },
        })
      : NextResponse.next();
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
  matcher: ['/drive/:path*', '/', '/onboarding'],
};

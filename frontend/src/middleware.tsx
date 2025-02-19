import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from 'services/auth/jwt';
import { UserInfo } from 'models/User';
import { cookies } from 'next/headers';

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

  const userInfo: UserInfo | null = await checkAuth(
    session.authProvider,
    session.accessToken,
  ).catch(() => null);

  if (!userInfo) {
    console.log('redirecting to home: 2');
    return pathname !== '/'
      ? NextResponse.redirect(new URL('/', req.url))
      : NextResponse.next();
  }

  if (!userInfo.onboarded) {
    console.log('redirecting to onboarding');
    return pathname.startsWith('/onboarding')
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/onboarding', req.url));
  }

  if (userInfo.onboarded) {
    const redirect = cookies().get('redirect');
    if (redirect?.value) {
      return NextResponse.redirect(new URL(redirect.value, req.url), {
        headers: {
          'Set-Cookie': 'redirect=; Path=/; HttpOnly; SameSite=Strict',
        },
      });
    }

    return pathname.startsWith('/drive')
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/drive', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/drive/:path*', '/', '/onboarding'],
};

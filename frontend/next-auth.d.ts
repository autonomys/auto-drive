import type * as nextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    error?: 'RefreshTokenError';
    accessToken?: string;
    authProvider?: string;
    authUserId?: string;
    underlyingProvider?: string;
    underlyingUserId?: string;
  }

  interface Account extends nextAuth.Account {
    expires_in: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    exp: number;
    iat: number;
    refreshToken?: string;
    error?: 'RefreshTokenError';
    authProvider?: string;
    authUserId?: string;
    underlyingProvider?: string;
    underlyingUserId?: string;
  }
}

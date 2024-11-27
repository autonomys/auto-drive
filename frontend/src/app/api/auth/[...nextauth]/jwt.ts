/* eslint-disable camelcase */
import { JWT } from 'next-auth/jwt';
import jwt from 'jsonwebtoken';

const ensureCorrectTokenFormation = (token: unknown) => {
  if (typeof token !== 'object' || token === null) {
    throw new Error('Token is not an object');
  }

  const typedToken = token as {
    oauthProvider: string;
    oauthUserId: string;
    exp: number;
    iat: number;
  };

  if (!typedToken.exp || !typedToken.iat) {
    throw new Error('Token has no expiration or issue date');
  }

  if (!typedToken.oauthProvider || !typedToken.oauthUserId) {
    throw new Error('Token is not setup and refreshable');
  }

  return typedToken;
};

const getRefreshTokenFromResponse = (response: Response): string => {
  const token = response.headers
    .get('set-cookie')
    ?.match(/refreshToken=([^;]+)/)?.[1];

  if (!token) {
    throw new Error('No refresh token found');
  }

  return token;
};

export const generateAccessToken = async ({
  provider,
  userId,
  oauthAccessToken,
}: {
  provider: string;
  userId: string;
  oauthAccessToken: string;
}): Promise<JWT> => {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/users/@me/accessToken`,
    {
      method: 'POST',
      headers: {
        'x-auth-provider': provider,
        Authorization: `Bearer ${oauthAccessToken}`,
      },
    },
  );

  const newTokens = await response.json();
  const accessToken = newTokens.accessToken;

  const token = ensureCorrectTokenFormation(jwt.decode(accessToken));
  const refreshToken = getRefreshTokenFromResponse(response);

  const nextJWT: JWT = {
    ...token,
    authProvider: 'custom-jwt',
    authUserId: token.oauthUserId,
    underlyingProvider: provider,
    underlyingUserId: userId,
    accessToken,
    refreshToken,
    oauthUser: {
      oauthProvider: provider,
      oauthUserId: userId,
    },
  };

  return nextJWT;
};

export const refreshAccessToken = async ({
  underlyingUserId,
  underlyingProvider,
  refreshToken,
}: {
  underlyingUserId: string;
  underlyingProvider: string;
  refreshToken: string;
}): Promise<JWT> => {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/users/@me/refreshToken`,
    {
      method: 'POST',
      headers: {
        Cookie: `refreshToken=${refreshToken};`,
      },
    },
  );

  const newTokens = await response.json();
  const accessToken = newTokens.accessToken;
  if (accessToken === null) {
    throw new Error('No access token found');
  }

  const token = ensureCorrectTokenFormation(jwt.decode(accessToken));

  const nextJWT: JWT = {
    ...token,
    authProvider: 'custom-jwt',
    authUserId: token.oauthUserId,
    accessToken,
    refreshToken,
    underlyingProvider,
    underlyingUserId,
  };

  return nextJWT;
};

export const invalidateRefreshToken = async ({
  refreshToken,
}: {
  refreshToken: string;
}): Promise<void> => {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/users/@me/invalidateToken`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        token: refreshToken,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to invalidate refresh token: ${response.statusText}`,
    );
  }
};

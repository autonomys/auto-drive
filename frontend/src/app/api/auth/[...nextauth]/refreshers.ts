/* eslint-disable camelcase */
import { JWT } from 'next-auth/jwt';
import jwt from 'jsonwebtoken';

const ensureCorrectTokenFormation = (token: unknown) => {
  if (typeof token !== 'object' || token === null) {
    throw new Error('Token is not an object');
  }

  const typedToken = token as JWT;

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
  oauthAccessToken,
}: {
  provider: string;
  oauthAccessToken: string;
}) => {
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
    provider: 'custom-jwt',
    accessToken,
    refreshToken,
  };

  return nextJWT;
};

export const refreshAccessToken = async ({
  refreshToken,
}: {
  refreshToken: string;
}) => {
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
  const token = ensureCorrectTokenFormation(jwt.decode(accessToken));

  const nextJWT: JWT = {
    ...token,
    provider: 'custom-jwt',
    accessToken,
    refreshToken,
  };

  return nextJWT;
};

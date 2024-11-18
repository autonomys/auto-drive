/* eslint-disable camelcase */
import { JWT } from 'next-auth/jwt';

export const refreshGoogleToken = async (token: JWT) => {
  if (!token.refreshToken) {
    throw new Error('No refresh token');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_AUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_AUTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken!,
    }),
  });

  const tokensOrError = await response.json();
  if (!response.ok) {
    console.log(response.statusText);
    throw new Error('Failed to refresh Google token');
  }

  const newTokens = tokensOrError as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  token.accessToken = newTokens.access_token;
  token.expires_at = Math.floor(Date.now() / 1000 + newTokens.expires_in);

  return token;
};

import { AuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GithubProvider from 'next-auth/providers/github';
import DiscordProvider from 'next-auth/providers/discord';
import {
  generateAccessToken,
  invalidateRefreshToken,
  refreshAccessToken,
} from './jwt';

// 1 minute before the token expires
const refreshingTokenThresholdInSeconds = process.env.REFRESHING_TOKEN_THRESHOLD
  ? parseInt(process.env.REFRESHING_TOKEN_THRESHOLD)
  : 60;

const ONE_WEEK_IN_SECONDS = 60 * 60 * 24 * 7;

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_AUTH_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET as string,
      authorization: {
        params: {
          // eslint-disable-next-line camelcase
          access_type: 'offline',
          prompt: 'consent',
          scope: 'email profile openid',
        },
      },
    }),
    DiscordProvider({
      clientId: process.env.DISCORD_AUTH_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_AUTH_CLIENT_SECRET as string,
      authorization: { params: { scope: 'identify' } },
    }),
    GithubProvider({
      clientId: process.env.GITHUB_AUTH_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_AUTH_CLIENT_SECRET as string,
    }),
  ],
  callbacks: {
    async jwt({ account, token }) {
      const isTokenSetupAndRefreshable =
        token.accessToken && token.authProvider && token.refreshToken;
      if (isTokenSetupAndRefreshable) {
        const accessToken = await refreshAccessToken({
          underlyingUserId: token.underlyingUserId!,
          underlyingProvider: token.underlyingProvider!,
          refreshToken: token.refreshToken!,
        });
        return accessToken;
      }

      const isOAuthSuccessfullyLoggedIn = account && account.access_token;
      if (isOAuthSuccessfullyLoggedIn) {
        return generateAccessToken({
          provider: account.provider,
          userId: account.providerAccountId,
          oauthAccessToken: account.access_token!,
        });
      }

      throw new Error('No account or token found');
    },
    async session({ session, token }) {
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const isTokenExpired =
        token.exp < nowInSeconds + refreshingTokenThresholdInSeconds;
      if (isTokenExpired) {
        const accessToken = await refreshAccessToken({
          underlyingUserId: token.underlyingUserId!,
          underlyingProvider: token.underlyingProvider!,
          refreshToken: token.refreshToken!,
        });
        session.accessToken = accessToken.accessToken;
      }
      session.accessToken = token.accessToken;
      session.authProvider = token.authProvider;
      session.authUserId = token.authUserId;
      session.underlyingProvider = token.underlyingProvider;
      session.underlyingUserId = token.underlyingUserId;
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: ONE_WEEK_IN_SECONDS,
  },
  events: {
    async signOut({ token }) {
      if (token.refreshToken) {
        await invalidateRefreshToken({ refreshToken: token.refreshToken });
      }
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

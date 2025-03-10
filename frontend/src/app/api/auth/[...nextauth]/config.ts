import { JsonRpcProvider } from 'ethers';
import { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import GithubProvider from 'next-auth/providers/github';
import DiscordProvider from 'next-auth/providers/discord';
import { getCsrfToken } from 'next-auth/react';
import { SiweMessage, VerifyOpts, VerifyParams } from 'siwe';
import {
  generateAccessToken,
  invalidateRefreshToken,
  refreshAccessToken,
} from './jwt';

// 1 minute before the token expires
const refreshingTokenThresholdInSeconds = process.env.REFRESHING_TOKEN_THRESHOLD
  ? parseInt(process.env.REFRESHING_TOKEN_THRESHOLD)
  : 60;

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_AUTH_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET as string,
      // eslint-disable-next-line camelcase
      authorization: { params: { access_type: 'offline', prompt: 'consent' } },
    }),
    DiscordProvider({
      clientId: process.env.DISCORD_AUTH_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_AUTH_CLIENT_SECRET as string,
    }),
    CredentialsProvider({
      id: 'auto-evm',
      name: 'Auto-EVM',
      credentials: {
        address: { label: 'EVM Address', type: 'text', placeholder: '0x...' },
        message: { label: 'Message', type: 'text', placeholder: '0x...' },
        signature: { label: 'Signature', type: 'text', placeholder: '0x...' },
      },
      authorize: async (credentials) => {
        try {
          if (!process.env.NEXT_PUBLIC_RPC_ENDPOINT)
            throw new Error('Missing Auto-EVM RPC URL');

          if (
            !credentials ||
            !credentials.address ||
            !credentials.message ||
            !credentials.signature
          )
            throw new Error('Missing credentials');

          const signature = credentials.signature;
          const message = new SiweMessage(credentials.message);

          if (message.address !== credentials.address)
            throw new Error('Invalid address');

          const verifyParams: VerifyParams = {
            signature,
            nonce: message.nonce,
            domain: message.domain,
          };

          const verifyOpts: VerifyOpts = {
            provider: new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_ENDPOINT),
            suppressExceptions: false,
          };

          if (!message.verify(verifyParams, verifyOpts))
            throw new Error('Invalid signature');

          return {
            id: 'evm:' + credentials.address,
            name: credentials.address,
          };
        } catch (error) {
          console.error('Nova authorize error', error);
          return null;
        }
      },
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
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-next-auth.session-token'
          : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        // 7 days
        maxAge: 60 * 60 * 24 * 7,
      },
    },
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

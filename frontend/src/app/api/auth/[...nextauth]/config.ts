import { JsonRpcProvider } from 'ethers';
import { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import GithubProvider from 'next-auth/providers/github';
import DiscordProvider from 'next-auth/providers/discord';
import { SiweMessage, VerifyOpts, VerifyParams } from 'siwe';
import {
  generateAccessToken,
  invalidateRefreshToken,
  refreshAccessToken,
} from './jwt';
import { encodeWalletProofInJWT } from './web3';

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
            id: credentials.address,
            provider: 'auto-evm',
            providerAccountId: credentials.address,
            userId: credentials.address,
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
    async signIn({ account, credentials, user }) {
      if (user.provider === 'auto-evm') {
        if (!account) throw new Error('No account found');
        if (!credentials) throw new Error('No credentials found');
        // eslint-disable-next-line camelcase
        account.access_token = encodeWalletProofInJWT(credentials);
        account.provider = user.provider;
        account.providerAccountId = user.id;
      }

      return true;
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

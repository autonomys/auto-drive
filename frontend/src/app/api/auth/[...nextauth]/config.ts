import { AuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import DiscordProvider from 'next-auth/providers/discord';
import { generateAccessToken, refreshAccessToken } from './refreshers';

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
  ],
  callbacks: {
    async jwt({ account, token }) {
      const isTokenSetupAndRefreshable =
        token.accessToken && token.authProvider && token.refreshToken;
      if (isTokenSetupAndRefreshable) {
        const accessToken = await refreshAccessToken({
          refreshToken: token.refreshToken!,
        });
        return accessToken;
      }

      const isOAuthSuccessfullyLoggedIn = account && account.access_token;
      if (isOAuthSuccessfullyLoggedIn) {
        return generateAccessToken({
          provider: account.provider,
          oauthAccessToken: account.access_token!,
        });
      }

      throw new Error('No account or token found');
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.authProvider = token.authProvider;
      session.authUserId = token.authUserId;
      return session;
    },
    async redirect({ url: _url, baseUrl: _baseUrl }) {
      const baseUrl = process.env.URL || _baseUrl;
      const url = _url.startsWith('/')
        ? `${baseUrl}${_url}`
        : _url.replace(_baseUrl, baseUrl);

      return url;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

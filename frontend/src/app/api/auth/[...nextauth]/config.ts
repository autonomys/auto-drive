import { AuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import DiscordProvider from 'next-auth/providers/discord';
import { refreshGoogleToken } from './refreshers';

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
    async jwt({ token, account }) {
      if (account) {
        token.provider = account?.provider;
        token.refreshToken = account?.refresh_token;
      } else {
        console.warn('No account found');
      }

      if (token.provider === 'google') {
        return refreshGoogleToken(token);
      }

      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.provider = token.provider;
      return session;
    },
    async redirect({ url: _url, baseUrl: _baseUrl }) {
      const baseUrl = process.env.URL || _baseUrl;
      const url = _url.startsWith('/')
        ? `${baseUrl}${_url}`
        : _url.replace(_baseUrl, baseUrl);

      return url;
    },
    signIn: async ({ account }) => {
      if (account) {
        // eslint-disable-next-line camelcase
        account.expires_at = Math.floor(Date.now() / 1000) + 10;
      }

      return true;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

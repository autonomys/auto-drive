import { AuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import DiscordProvider from 'next-auth/providers/discord';
export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_AUTH_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET as string,
      checks: [],
    }),
    DiscordProvider({
      clientId: process.env.DISCORD_AUTH_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_AUTH_CLIENT_SECRET as string,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account?.access_token;
        token.provider = account?.provider;
      } else {
        console.warn('No account found');
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
  },
  secret: process.env.NEXTAUTH_SECRET,
};

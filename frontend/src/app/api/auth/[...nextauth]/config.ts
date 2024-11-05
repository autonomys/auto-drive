import { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import DiscordProvider from "next-auth/providers/discord";
export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.NEXT_PUBLIC_GOOGLE_AUTH_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET as string,
      checks: [],
    }),
    DiscordProvider({
      clientId: process.env.NEXT_PUBLIC_DISCORD_AUTH_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_AUTH_CLIENT_SECRET as string,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account?.access_token;
        token.provider = account?.provider;
      } else {
        console.warn("No account found");
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.provider = token.provider;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

declare module "next-auth" {
  interface Session {
    error?: "RefreshTokenError";
    accessToken?: string;
    provider?: string;
  }

  interface Account {
    expires_in: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    expires_at: number;
    refresh_token?: string;
    error?: "RefreshTokenError";
    provider?: string;
  }
}

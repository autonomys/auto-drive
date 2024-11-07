import type * as nextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    error?: "RefreshTokenError";
    accessToken?: string;
    provider?: string;
  }

  interface Account extends nextAuth.Account {
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

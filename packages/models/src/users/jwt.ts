type BaseTokenPayload = {
  id: string;
  isRefreshToken: boolean;
  oauthProvider: string;
  oauthUserId: string;
  oauthUsername?: string;
  oauthAvatarUrl?: string;
};

export type CustomAccessTokenPayload = BaseTokenPayload & {
  isRefreshToken: false;
  // Null for partner end users, who get no refresh token.
  refreshTokenId: string | null;
  "https://hasura.io/jwt/claims": {
    "x-hasura-default-role": string;
    "x-hasura-allowed-roles": string[];
    "x-hasura-oauth-provider": string;
    "x-hasura-oauth-user-id": string;
    "x-hasura-organization-id": string;
    "x-hasura-public-id": string;
  };
};

export type CustomRefreshTokenPayload = BaseTokenPayload & {
  isRefreshToken: true;
};

export type CustomTokenPayload =
  | CustomAccessTokenPayload
  | CustomRefreshTokenPayload;

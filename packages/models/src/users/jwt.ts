type BaseTokenPayload = {
  id: string;
  isRefreshToken: boolean;
  oauthProvider: string;
  oauthUserId: string;
};

export type CustomAccessTokenPayload = BaseTokenPayload & {
  isRefreshToken: false;
  refreshTokenId: string;
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

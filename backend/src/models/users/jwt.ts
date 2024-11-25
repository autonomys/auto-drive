type BaseTokenPayload = {
  id: string
  isRefreshToken: boolean
  oauthProvider: string
  oauthUserId: string
}

export type CustomAccessTokenPayload = BaseTokenPayload & {
  isRefreshToken: false
  refreshTokenId: string
}

export type CustomRefreshTokenPayload = BaseTokenPayload & {
  isRefreshToken: true
}

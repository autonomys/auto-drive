import { OAuthUser } from '@auto-drive/models'
import { APIKeyAuth } from './providers/apikey.js'
import { CustomJWTAuth } from './providers/custom.js'
import {
  DiscordAuth,
  GitHubAuth,
  GoogleAuth,
  Web3Auth,
} from './providers/index.js'

const getUserFromAccessToken = async (
  provider: string,
  accessToken: string,
): Promise<OAuthUser> => {
  switch (provider) {
    case 'google':
      return GoogleAuth.getUserFromAccessToken(accessToken)
    case 'discord':
      return DiscordAuth.getUserFromAccessToken(accessToken)
    case 'apikey':
      return APIKeyAuth.getUserFromAPIKey(accessToken)
    case 'custom-jwt':
      return CustomJWTAuth.getUserFromAccessToken(accessToken)
    case 'github':
      return GitHubAuth.getUserFromAccessToken(accessToken)
    case 'web3-wallet':
      return Web3Auth.getUserFromAccessToken(accessToken)
    default:
      throw new Error('Invalid provider')
  }
}

export const AuthManager = {
  getUserFromAccessToken,
}

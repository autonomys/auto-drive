import { OAuthUser } from '@auto-drive/models'
import { ApiKeysUseCases } from '../../../useCases/apikeys.js'

const getUserFromApiKey = async (secret: string): Promise<OAuthUser> => {
  const apiKey = await ApiKeysUseCases.getApiKeyFromSecret(secret)

  return {
    provider: apiKey.oauthProvider,
    id: apiKey.oauthUserId,
  }
}

export const ApiKeyAuth = {
  getUserFromApiKey,
}

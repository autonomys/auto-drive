import { OAuthUser } from '@auto-drive/models'
import { APIKeysUseCases } from '../../../useCases/apikeys.js'
import { usersRepository } from '../../../repositories/users.js'

const getUserFromAPIKey = async (secret: string): Promise<OAuthUser> => {
  const apiKey = await APIKeysUseCases.getAPIKeyFromSecret(secret)

  // Look up the full user row so that oauthUsername and oauthAvatarUrl are
  // available downstream.  Without this, feature flag checks that inspect
  // oauthUsername (e.g. staff domain / allowlist checks for buyCredits)
  // fail because the username is undefined.
  const dbUser = await usersRepository.getUserByOAuthInformation(
    apiKey.oauthProvider,
    apiKey.oauthUserId,
  )

  return {
    provider: apiKey.oauthProvider,
    id: apiKey.oauthUserId,
    username: dbUser?.oauth_username ?? undefined,
    avatarUrl: dbUser?.oauth_avatar_url ?? undefined,
  }
}

export const APIKeyAuth = {
  getUserFromAPIKey,
}

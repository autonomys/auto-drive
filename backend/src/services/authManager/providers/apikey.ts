import { OAuthUser } from "../../../models/users/index.js";
import { ApiKeysUseCases } from "../../../useCases/users/apikeys.js";

const getUserFromApiKey = async (secret: string): Promise<OAuthUser> => {
  const apiKey = await ApiKeysUseCases.getApiKeyFromSecret(secret);

  return {
    provider: apiKey.oauthProvider,
    id: apiKey.oauthUserId,
  };
};

export const ApiKeyAuth = {
  getUserFromApiKey,
};

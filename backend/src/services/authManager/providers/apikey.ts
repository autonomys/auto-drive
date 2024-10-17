import { OAuthUser } from "../../../models/index.js";
import { ApiKeysUseCases } from "../../../useCases/apikeys.js";

const getUserFromApiKey = async (apiKey: string): Promise<OAuthUser> => {
  const userId = await ApiKeysUseCases.getUserIdFromApiKey(apiKey);

  return {
    id: userId,
    provider: "apikey",
    email: "",
  };
};

export const ApiKeyAuth = {
  getUserFromApiKey,
};

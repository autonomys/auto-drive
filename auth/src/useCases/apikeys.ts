import { v4 } from "uuid";
import { apiKeysRepository } from "../repositories/index";
import { User, ApiKey, ApiKeyWithoutSecret } from "../models/index";

const createApiKey = async (executor: User): Promise<ApiKey> => {
  const secret = v4({}).replace(/-/g, "");
  const id = v4().replace(/-/g, "");

  const apiKeyObject = await apiKeysRepository.createApiKey(
    id,
    secret,
    executor.oauthProvider,
    executor.oauthUserId
  );

  return apiKeyObject;
};

const getApiKeyFromSecret = async (secret: string): Promise<ApiKey> => {
  const apiKeyObject = await apiKeysRepository.getApiKeyBySecret(secret);

  if (!apiKeyObject) {
    throw new Error("Api key not found");
  }
  if (apiKeyObject.deletedAt) {
    throw new Error("Api key has been deleted");
  }

  return apiKeyObject;
};

const deleteApiKey = async (executor: User, id: string): Promise<void> => {
  const apiKeyObject = await apiKeysRepository.getApiKeyById(id);
  if (!apiKeyObject) {
    throw new Error("Api key not found");
  }

  if (
    apiKeyObject.oauthProvider !== executor.oauthProvider ||
    apiKeyObject.oauthUserId !== executor.oauthUserId
  ) {
    throw new Error("User is not the owner of the API key");
  }

  await apiKeysRepository.deleteApiKey(id);
};

const getApiKeysByUser = async (user: User): Promise<ApiKeyWithoutSecret[]> => {
  const apiKeys = await apiKeysRepository.getApiKeysByOAuthUser(
    user.oauthProvider,
    user.oauthUserId
  );

  return apiKeys.map((apiKey) => {
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      secret,
      ...apiKeyWithoutSecret
    } = apiKey;
    return apiKeyWithoutSecret;
  });
};

export const ApiKeysUseCases = {
  createApiKey,
  getApiKeyFromSecret,
  deleteApiKey,
  getApiKeysByUser,
};

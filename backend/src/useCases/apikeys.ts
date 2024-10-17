import { v4 } from "uuid";
import { apiKeysRepository } from "../repositories/index.js";
import { User } from "../models/index.js";
import { UsersUseCases } from "./users.js";

const createApiKey = async (user: User) => {
  const isAdmin = await UsersUseCases.isAdminUser(user);
  if (!isAdmin) {
    throw new Error("User does not have admin privileges");
  }

  const apiKey = v4({}).replace(/-/g, "");
  const userId = v4().replace(/-/g, "");

  const apiKeyObject = await apiKeysRepository.createApiKey(apiKey, userId);

  return apiKeyObject;
};

const getUserIdFromApiKey = async (apiKey: string): Promise<string> => {
  const apiKeyObject = await apiKeysRepository.getApiKey(apiKey);

  if (!apiKeyObject) {
    throw new Error("Invalid API key");
  }

  return apiKeyObject.userId;
};

export const ApiKeysUseCases = {
  createApiKey,
  getUserIdFromApiKey,
};

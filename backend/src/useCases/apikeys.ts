import { v4 } from "uuid";
import { apiKeysRepository, usersRepository } from "../repositories/index.js";
import { User, UserRole } from "../models/index.js";
import { UsersUseCases } from "./users.js";
import { OrganizationsUseCases } from "./organizations.js";

const createApiKey = async (executor: User) => {
  const isAdmin = await UsersUseCases.isAdminUser(executor);
  if (!isAdmin) {
    throw new Error("User does not have admin privileges");
  }

  const apiKey = v4({}).replace(/-/g, "");
  const userId = v4().replace(/-/g, "");

  const apiKeyObject = await apiKeysRepository.createApiKey(apiKey, userId);

  await UsersUseCases.initUser("apikey", userId, userId);

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
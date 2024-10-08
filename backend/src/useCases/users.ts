import {
  OAuthUser,
  User,
  userFromOAuth,
  userFromTable,
} from "../models/index.js";
import { usersRepository } from "../repositories/index.js";

const updateUserHandle = async (
  user: User,
  handle: string
): Promise<User | undefined> => {
  console.log("Updating user handle", user, handle);

  const updatedUser = await usersRepository.updateHandle(
    user.oauthProvider,
    user.oauthUserId,
    handle
  );

  return userFromTable({
    oauthProvider: updatedUser.oauth_provider,
    oauthUserId: updatedUser.oauth_user_id,
    handle: updatedUser.handle,
  });
};

const getUserByOAuthUser = async (user: OAuthUser): Promise<User> => {
  const dbUser = await usersRepository.getUserByOAuthInformation(
    user.provider,
    user.id
  );
  if (!dbUser) {
    return userFromOAuth({
      oauthProvider: user.provider,
      oauthUserId: user.id,
    });
  }

  return userFromTable({
    oauthProvider: dbUser.oauth_provider,
    oauthUserId: dbUser.oauth_user_id,
    handle: dbUser.handle,
  });
};

const getUserByHandle = async (handle: string): Promise<User | undefined> => {
  const dbUser = await usersRepository.getUserByHandle(handle);
  if (!dbUser) {
    return undefined;
  }

  return userFromTable({
    oauthProvider: dbUser.oauth_provider,
    oauthUserId: dbUser.oauth_user_id,
    handle: dbUser.handle,
  });
};

const searchUsersByHandle = async (handle: string): Promise<string[]> => {
  const maxResults = 10;
  const dbUsers = await usersRepository.searchUsersByHandle(handle, maxResults);

  return dbUsers.map((e) => e.handle);
};

export const UsersUseCases = {
  updateUserHandle,
  getUserByOAuthUser,
  getUserByHandle,
  searchUsersByHandle,
};

import { Credits } from "../models/credits.js";
import {
  OAuthUser,
  User,
  userFromOAuth,
  userFromTable,
  UserOrHandle,
  UserRole,
} from "../models/index.js";
import { usersRepository } from "../repositories/index.js";

const getUserByHandle = async (handle: string): Promise<User | undefined> => {
  const dbUser = await usersRepository.getUserByHandle(handle);
  if (!dbUser) {
    return undefined;
  }

  return userFromTable({
    oauthProvider: dbUser.oauth_provider,
    oauthUserId: dbUser.oauth_user_id,
    handle: dbUser.handle,
    role: dbUser.role,
    downloadCredits: dbUser.download_credits,
    uploadCredits: dbUser.upload_credits,
  });
};

const resolveUser = async (userOrHandle: UserOrHandle): Promise<User> => {
  if (userOrHandle === null) {
    throw new Error("User not found (handle=null)");
  }

  const isHandle = typeof userOrHandle === "string";
  let user: User | undefined = isHandle
    ? await getUserByHandle(userOrHandle)
    : userOrHandle;
  if (!user) {
    throw new Error("User not found");
  }
  return user;
};

const updateUserHandle = async (
  user: User,
  handle: string
): Promise<User | undefined> => {
  const updatedUser = await usersRepository.updateHandle(
    user.oauthProvider,
    user.oauthUserId,
    handle
  );

  return userFromTable({
    oauthProvider: updatedUser.oauth_provider,
    oauthUserId: updatedUser.oauth_user_id,
    handle: updatedUser.handle,
    role: updatedUser.role,
    downloadCredits: updatedUser.download_credits,
    uploadCredits: updatedUser.upload_credits,
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
      role: UserRole.User,
      downloadCredits: 0,
      uploadCredits: 0,
    });
  }

  return userFromTable({
    oauthProvider: dbUser.oauth_provider,
    oauthUserId: dbUser.oauth_user_id,
    handle: dbUser.handle,
    role: dbUser.role,
    downloadCredits: dbUser.download_credits,
    uploadCredits: dbUser.upload_credits,
  });
};

const searchUsersByHandle = async (handle: string): Promise<string[]> => {
  const maxResults = 10;
  const dbUsers = await usersRepository.searchUsersByHandle(handle, maxResults);

  return dbUsers.map((e) => e.handle);
};

const isAdminUser = async (userOrHandle: UserOrHandle): Promise<boolean> => {
  const user = await resolveUser(userOrHandle);

  const adminUser = await usersRepository.getUserByOAuthInformation(
    user.oauthProvider,
    user.oauthUserId
  );

  return adminUser?.role === UserRole.Admin;
};

const updateRole = async (
  executor: User,
  userOrHandle: UserOrHandle,
  role: UserRole
) => {
  const isAdmin = await isAdminUser(executor);
  if (!isAdmin) {
    throw new Error("User does not have admin privileges");
  }

  const user = await resolveUser(userOrHandle);

  return usersRepository.updateRole(user.oauthProvider, user.oauthUserId, role);
};

const addDownloadCreditsToUser = async (
  executor: User,
  userOrHandle: UserOrHandle,
  credits: number
): Promise<void> => {
  const hasAdminPrivileges = await UsersUseCases.isAdminUser(executor);
  if (!hasAdminPrivileges) {
    throw new Error("User does not have admin privileges");
  }
  const user = await resolveUser(userOrHandle);

  await usersRepository.addDownloadCredits(
    user.oauthProvider,
    user.oauthUserId,
    credits
  );
};

const addUploadCreditsToUser = async (
  executor: User,
  userOrHandle: UserOrHandle,
  credits: number
): Promise<void> => {
  const hasAdminPrivileges = await UsersUseCases.isAdminUser(executor);
  if (!hasAdminPrivileges) {
    throw new Error("User does not have admin privileges");
  }

  const user = await resolveUser(userOrHandle);

  await usersRepository.addUploadCredits(
    user.oauthProvider,
    user.oauthUserId,
    credits
  );
};

const subtractDownloadCreditsFromUser = async (
  executor: User,
  credits: number
): Promise<void> => {
  if (credits <= 0) {
    throw new Error("Credits must be positive");
  }

  await usersRepository.subtractDownloadCredits(
    executor.oauthProvider,
    executor.oauthUserId,
    credits
  );
};

const subtractUploadCreditsFromUser = async (
  executor: User,
  credits: number
): Promise<void> => {
  if (credits <= 0) {
    throw new Error("Credits must be positive");
  }

  await usersRepository.subtractUploadCredits(
    executor.oauthProvider,
    executor.oauthUserId,
    credits
  );
};

const getCreditsForUser = async (user: User): Promise<Credits> => {
  const credits = await usersRepository.getUserByOAuthInformation(
    user.oauthProvider,
    user.oauthUserId
  );

  if (!credits) {
    throw new Error("User not found");
  }

  return {
    downloadCredits: credits.download_credits,
    uploadCredits: credits.upload_credits,
  };
};

const getUserList = async (reader: User): Promise<User[]> => {
  const isAdmin = await UsersUseCases.isAdminUser(reader);
  if (!isAdmin) {
    throw new Error("User does not have admin privileges");
  }

  const dbUsers = await usersRepository.getAllUsers();
  return dbUsers.map((e) =>
    userFromTable({
      oauthProvider: e.oauth_provider,
      oauthUserId: e.oauth_user_id,
      handle: e.handle,
      role: e.role,
      downloadCredits: e.download_credits,
      uploadCredits: e.upload_credits,
    })
  );
};

const initUser = async (
  oauth_provider: string,
  oauth_user_id: string,
  handle: string,
  role: UserRole = UserRole.User
) => {
  const INITIAL_DOWNLOAD_CREDITS = 10_000_000_000;
  const INITIAL_UPLOAD_CREDITS = 10_000_000_000;

  await usersRepository.createUser(
    oauth_provider,
    oauth_user_id,
    handle,
    role,
    INITIAL_DOWNLOAD_CREDITS,
    INITIAL_UPLOAD_CREDITS
  );
};

export const UsersUseCases = {
  updateUserHandle,
  getUserByOAuthUser,
  getUserByHandle,
  searchUsersByHandle,
  isAdminUser,
  updateRole,
  resolveUser,
  addDownloadCreditsToUser,
  addUploadCreditsToUser,
  getCreditsForUser,
  subtractDownloadCreditsFromUser,
  subtractUploadCreditsFromUser,
  getUserList,
  initUser,
};

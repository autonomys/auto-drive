import { Credits } from "../models/credits.js";
import {
  OAuthUser,
  User,
  userFromOAuth,
  userFromTable,
  UserInfo,
  UserOrHandle,
  UserRole,
} from "../models/index.js";
import { InteractionType } from "../models/interactions.js";
import {
  SubscriptionInfo,
  SubscriptionWithUser,
} from "../models/subscription.js";
import { usersRepository } from "../repositories/index.js";
import { InteractionsUseCases } from "./interactions.js";
import { OrganizationsUseCases } from "./organizations.js";
import { SubscriptionsUseCases } from "./subscriptions.js";

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

const onboardUser = async (
  user: User,
  handle: string
): Promise<User | undefined> => {
  const updatedUser = await UsersUseCases.initUser(
    user.oauthProvider,
    user.oauthUserId,
    handle
  );

  return updatedUser;
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
    });
  }

  return userFromTable({
    oauthProvider: dbUser.oauth_provider,
    oauthUserId: dbUser.oauth_user_id,
    handle: dbUser.handle,
    role: dbUser.role,
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

const getUserInfo = async (userOrHandle: UserOrHandle): Promise<UserInfo> => {
  const user = await resolveUser(userOrHandle);

  if (!user.onboarded) {
    return { user };
  }

  const subscription = await SubscriptionsUseCases.getSubscriptionInfo(user);

  return { user, subscription };
};

const getUserList = async (reader: User): Promise<SubscriptionWithUser[]> => {
  const isAdmin = await UsersUseCases.isAdminUser(reader);
  if (!isAdmin) {
    throw new Error("User does not have admin privileges");
  }

  const users = await usersRepository.getAllUsers();

  return Promise.all(
    users.map(async (user) => {
      const subscription = await SubscriptionsUseCases.getSubscription(
        user.handle
      );
      return {
        ...subscription,
        user: userFromTable({
          oauthProvider: user.oauth_provider,
          oauthUserId: user.oauth_user_id,
          handle: user.handle,
          role: user.role,
        }),
      };
    })
  );
};

const initUser = async (
  oauth_provider: string,
  oauth_user_id: string,
  handle: string,
  role: UserRole = UserRole.User
): Promise<User> => {
  const user = await usersRepository.createUser(
    oauth_provider,
    oauth_user_id,
    handle,
    role
  );
  if (!user) {
    throw new Error("User creation failed");
  }

  await OrganizationsUseCases.initOrganization(
    userFromTable({
      oauthProvider: oauth_provider,
      oauthUserId: oauth_user_id,
      handle: handle,
      role: role,
    })
  );

  return userFromTable({
    oauthProvider: user.oauth_provider,
    oauthUserId: user.oauth_user_id,
    handle: user.handle,
    role: user.role,
  });
};

const getPendingCreditsByUserAndType = async (
  userOrHandle: UserOrHandle,
  type: InteractionType
): Promise<number> => {
  const subscription = await SubscriptionsUseCases.getSubscription(
    userOrHandle
  );

  return SubscriptionsUseCases.getPendingCreditsBySubscriptionAndType(
    subscription,
    type
  );
};

const registerInteraction = async (
  userOrHandle: UserOrHandle,
  type: InteractionType,
  size: number
) => {
  const subscription = await SubscriptionsUseCases.getSubscription(
    userOrHandle
  );

  await InteractionsUseCases.createInteraction(subscription.id, type, size);
};

export const UsersUseCases = {
  onboardUser,
  getUserByOAuthUser,
  getUserByHandle,
  searchUsersByHandle,
  isAdminUser,
  updateRole,
  resolveUser,
  getUserList,
  getPendingCreditsByUserAndType,
  getUserInfo,
  initUser,
  registerInteraction,
};

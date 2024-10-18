import { v4 } from "uuid";
import { User, UserOrHandle } from "../models/user.js";
import {
  Subscription,
  SubscriptionGranularity,
  SubscriptionInfo,
} from "../models/subscription.js";
import { subscriptionsRepository } from "../repositories/subscriptions.js";
import { OrganizationsUseCases } from "./organizations.js";
import { UsersUseCases } from "./users.js";
import { interactionsRepository } from "../repositories/interactions.js";
import { InteractionType } from "../models/interactions.js";

const updateSubscription = async (
  executor: User,
  userOrHandle: UserOrHandle,
  granularity: SubscriptionGranularity,
  uploadLimit: number,
  downloadLimit: number
): Promise<void> => {
  const isAdmin = await UsersUseCases.isAdminUser(executor);
  if (!isAdmin) {
    throw new Error("User is not an admin");
  }

  const user = await UsersUseCases.resolveUser(userOrHandle);

  const organization = await OrganizationsUseCases.getOrganizationByUser(user);

  const subscription = await subscriptionsRepository.getByOrganizationId(
    organization.id
  );

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  await subscriptionsRepository.updateSubscription(
    subscription.id,
    granularity,
    uploadLimit,
    downloadLimit
  );
};

const getSubscription = async (
  userOrHandle: UserOrHandle
): Promise<Subscription> => {
  const user = await UsersUseCases.resolveUser(userOrHandle);

  const organization = await OrganizationsUseCases.getOrganizationByUser(user);

  const subscription = await subscriptionsRepository.getByOrganizationId(
    organization.id
  );

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  return subscription;
};

const initSubscription = async (organizationId: string): Promise<void> => {
  const subscription = await subscriptionsRepository.getByOrganizationId(
    organizationId
  );
  if (subscription) {
    throw new Error("Subscription already exists");
  }

  const INITIAL_GRANULARITY: SubscriptionGranularity = "monthly";
  const HUNDRED_MB = 1024 ** 2 * 100;
  const FIVE_GB = 1024 ** 3 * 5;
  const INITIAL_UPLOAD_LIMIT: number = HUNDRED_MB;
  const INITIAL_DOWNLOAD_LIMIT: number = FIVE_GB;
  await subscriptionsRepository.createSubscription(
    v4(),
    organizationId,
    INITIAL_GRANULARITY,
    INITIAL_UPLOAD_LIMIT,
    INITIAL_DOWNLOAD_LIMIT
  );
};

const getPendingCreditsBySubscriptionAndType = async (
  subscription: Subscription,
  type: InteractionType
): Promise<number> => {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  const interactions =
    await interactionsRepository.getInteractionsBySubscriptionIdAndTypeInTimeRange(
      subscription.id,
      type,
      start,
      end
    );

  const spentCredits = interactions.reduce((acc, interaction) => {
    return acc + interaction.size;
  }, 0);

  const limit =
    type === InteractionType.Upload
      ? subscription.uploadLimit
      : subscription.downloadLimit;

  return limit - spentCredits;
};

const getSubscriptionInfo = async (
  userOrHandle: UserOrHandle
): Promise<SubscriptionInfo> => {
  const subscription = await SubscriptionsUseCases.getSubscription(
    userOrHandle
  );

  const pendingUploadCredits = await getPendingCreditsBySubscriptionAndType(
    subscription,
    InteractionType.Upload
  );
  const pendingDownloadCredits = await getPendingCreditsBySubscriptionAndType(
    subscription,
    InteractionType.Download
  );

  return {
    ...subscription,
    pendingUploadCredits,
    pendingDownloadCredits,
  };
};

export const SubscriptionsUseCases = {
  updateSubscription,
  getSubscription,
  initSubscription,
  getPendingCreditsBySubscriptionAndType,
  getSubscriptionInfo,
};

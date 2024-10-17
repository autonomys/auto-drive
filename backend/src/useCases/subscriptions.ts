import { v4 } from "uuid";
import { User, UserOrHandle } from "../models/user.js";
import {
  Subscription,
  SubscriptionGranularity,
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
  limit: number
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
    limit
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
  const INITIAL_LIMIT: number = 1024 ** 2;

  await subscriptionsRepository.createSubscription(
    v4(),
    organizationId,
    INITIAL_GRANULARITY,
    INITIAL_LIMIT
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

  return subscription.limit - spentCredits;
};

export const SubscriptionsUseCases = {
  updateSubscription,
  getSubscription,
  initSubscription,
  getPendingCreditsBySubscriptionAndType,
};

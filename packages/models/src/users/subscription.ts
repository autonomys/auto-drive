import { User } from "./user";

export type Subscription = {
  id: string;
  organizationId: string;
  uploadLimit: number;
  downloadLimit: number;
  granularity: SubscriptionGranularity;
};

export type SubscriptionGranularity = "monthly";

export type SubscriptionInfoWithUser = SubscriptionInfo & {
  user: User;
};

export type SubscriptionInfo = Subscription & {
  pendingUploadCredits: number;
  pendingDownloadCredits: number;
};

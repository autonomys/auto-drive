import { User } from "./User";

export type Subscription = {
  id: string;
  organizationId: string;
  uploadLimit: number;
  downloadLimit: number;
  granularity: SubscriptionGranularity;
};

export type SubscriptionGranularity = "monthly";

export type SubscriptionWithUser = Subscription & {
  user: User;
};

export type SubscriptionInfo = Subscription & {
  pendingUploadCredits: number;
  pendingDownloadCredits: number;
};

import { User } from "./user";

export type Subscription = {
  id: string;
  organizationId: string;
  uploadLimit: number;
  downloadLimit: number;
  granularity: SubscriptionGranularity;
};

export enum SubscriptionGranularity {
  Monthly = "monthly",
  OneOff = "one_off",
}

export type SubscriptionInfoWithUser = SubscriptionInfo & {
  user: User;
};

export type SubscriptionInfo = Subscription & {
  pendingUploadCredits: number;
  pendingDownloadCredits: number;
};

export type Subscription = {
  id: string;
  limit: number;
  granularity: SubscriptionGranularity;
};

export type SubscriptionGranularity = "monthly";

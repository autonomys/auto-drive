import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SubscriptionInfo, User } from '@auto-drive/models';

interface UserStore {
  user: User | null;
  subscription: SubscriptionInfo | null;
  features: Record<string, boolean>;
  setUser: (user: User | null) => void;
  clearUser: () => void;
  setFeatures: (features: Record<string, boolean>) => void;
  setSubscription: (subscriptionInfo: SubscriptionInfo) => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      subscription: null,
      setUser: (user: User | null) =>
        set({
          user: user,
        }),
      clearUser: () => set({ user: null, subscription: null }),
      setSubscription: (subscriptionInfo: SubscriptionInfo) =>
        set({
          subscription: subscriptionInfo,
        }),
      features: {},
      setFeatures: (features: Record<string, boolean>) => set({ features }),
    }),
    {
      name: 'user-dto-storage',
      version: 1,
    },
  ),
);

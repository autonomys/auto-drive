import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SubscriptionInfo, User } from '@auto-drive/models';

interface UserStore {
  user: User | null;
  subscription: SubscriptionInfo | null;
  setUser: (user: User) => void;
  clearUser: () => void;
  setSubscription: (subcriptionInfo: SubscriptionInfo) => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      subscription: null,
      setUser: (user: User) =>
        set({
          user: user,
        }),
      clearUser: () => set({ user: null, subscription: null }),
      setSubscription: (subcriptionInfo: SubscriptionInfo) =>
        set({
          subscription: subcriptionInfo,
        }),
    }),
    {
      name: 'user-dto-storage',
      version: 1,
    },
  ),
);

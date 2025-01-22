import { ApiService } from '../services/api';
import { User, UserInfo } from '../models/User.js';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { SubscriptionInfo } from '../models/Subscriptions';
import { AuthService } from '../services/auth/auth';

interface UserStore {
  user: User | null;
  subscription: SubscriptionInfo | null;
  setUser: (user: UserInfo) => void;
  clearUser: () => void;
  updateUser: () => void;
  updateSubscription: () => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      subscription: null,
      setUser: (userInfo: UserInfo) =>
        set({
          user: userInfo,
        }),
      clearUser: () => set({ user: null, subscription: null }),
      updateUser: () => {
        AuthService.getMe().then((userInfo) => {
          set({
            user: userInfo,
          });
        });
      },
      updateSubscription: () => {
        ApiService.getSubscription().then((subscription) => {
          set({
            subscription,
          });
        });
      },
    }),
    {
      name: 'user-dto-storage',
      version: 1,
    },
  ),
);

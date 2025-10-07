import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AccountInfo, User } from '@auto-drive/models';

interface UserStore {
  user: User | null;
  account: AccountInfo | null;
  features: Record<string, boolean>;
  setFeatures: (features: Record<string, boolean>) => void;
  setAccount: (account: AccountInfo) => void;
  setUser: (user: User | null) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      account: null,
      setUser: (user: User | null) =>
        set({
          user: user,
        }),
      clearUser: () => set({ user: null, account: null }),
      setAccount: (account: AccountInfo) =>
        set({
          account,
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

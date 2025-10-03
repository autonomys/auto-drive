import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AccountInfo, User } from '@auto-drive/models';

interface UserStore {
  user: User | null;
  account: AccountInfo | null;
  setUser: (user: User | null) => void;
  clearUser: () => void;
  setAccount: (accountInfo: AccountInfo) => void;
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
    }),
    {
      name: 'user-dto-storage',
      version: 1,
    },
  ),
);

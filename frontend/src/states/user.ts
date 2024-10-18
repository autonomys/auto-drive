import { ApiService } from "../services/api";
import { User, UserInfo } from "../../../backend/src/models/user";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SubscriptionInfo } from "../models/Subscriptions";

interface UserStore {
  user: User | null;
  subscription: SubscriptionInfo | null;
  setUser: (user: UserInfo) => void;
  clearUser: () => void;
  updateUser: () => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      subscription: null,
      setUser: (userInfo: UserInfo) => set(userInfo),
      clearUser: () => set({ user: null, subscription: null }),
      updateUser: () => {
        ApiService.getMe().then((userInfo) => set(userInfo));
      },
    }),
    {
      name: "user-dto-storage",
      version: 1,
    }
  )
);

import { ApiService } from "../services/api";
import { User } from "../../../backend/src/models/user";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UserStore {
  user: User | null;
  setUser: (user: User) => void;
  clearUser: () => void;
  updateUser: () => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user: User) => set({ user }),
      clearUser: () => set({ user: null }),
      updateUser: () => {
        ApiService.getMe().then((user) => set({ user }));
      },
    }),
    {
      name: "user-dto-storage",
    }
  )
);

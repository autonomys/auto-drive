import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EncryptionStore {
  password: string;
  setPassword: (password: string) => void;
}

export const useEncryptionStore = create<EncryptionStore>()(
  persist(
    (set) => ({
      password: "",
      setPassword: (password) => set({ password }),
    }),
    {
      name: "encryption-storage",
      version: 1,
    }
  )
);

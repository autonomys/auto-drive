import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UploadOptions {
  ignoreEncryption: boolean;
  compress: boolean;
}

export const useUploadOptionsStore = create<UploadOptionsStore>()(
  persist(
    (set) => ({
      scope: {
        ignoreEncryption: false,
        compress: true,
      },
      setScope: (scope: UploadOptions) => set({ scope }),
      updateIgnoreEncryption: (opts: Partial<UploadOptions>) =>
        set((state) => ({ scope: { ...state.scope, ...opts } })),
    }),
    { name: "upload-options-storage", version: 1 }
  )
);

interface UploadOptionsStore {
  scope: UploadOptions;
  setScope: (scope: UploadOptions) => void;
  updateIgnoreEncryption: (opts: Partial<UploadOptions>) => void;
}

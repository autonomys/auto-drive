import { AsyncDownload } from '@auto-drive/models';
import { create } from 'zustand';

interface UserAsyncDownloadsStore {
  asyncDownloads: AsyncDownload[];
  fetcher: (() => Promise<AsyncDownload[]>) | undefined;
  setFetcher: (fetcher: (() => Promise<AsyncDownload[]>) | undefined) => void;
  update: () => void;
}

export const useUserAsyncDownloadsStore = create<UserAsyncDownloadsStore>(
  (set, get) => ({
    asyncDownloads: [],
    fetcher: undefined,
    setFetcher: (fetcher: (() => Promise<AsyncDownload[]>) | undefined) => {
      set({ fetcher });
      get().update();
    },
    update: () => {
      const fetcher = get().fetcher?.();
      fetcher?.then((asyncDownloads) => {
        set({ asyncDownloads });
      });
    },
  }),
);

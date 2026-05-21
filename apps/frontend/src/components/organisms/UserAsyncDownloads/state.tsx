import { AsyncDownload } from '@auto-drive/models';
import { create } from 'zustand';

export interface PendingAutoDownload {
  cid: string;
  password?: string;
  skipDecryption: boolean;
  fileName?: string;
}

interface UserAsyncDownloadsStore {
  asyncDownloads: AsyncDownload[];
  fetcher: (() => Promise<AsyncDownload[]>) | undefined;
  pendingAutoDownloads: PendingAutoDownload[];
  setFetcher: (fetcher: (() => Promise<AsyncDownload[]>) | undefined) => void;
  update: () => void;
  addPendingAutoDownload: (download: PendingAutoDownload) => void;
  removePendingAutoDownload: (cid: string) => void;
}

export const useUserAsyncDownloadsStore = create<UserAsyncDownloadsStore>(
  (set, get) => ({
    asyncDownloads: [],
    fetcher: undefined,
    pendingAutoDownloads: [],
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
    addPendingAutoDownload: (download: PendingAutoDownload) => {
      set((state) => {
        if (state.pendingAutoDownloads.some((d) => d.cid === download.cid)) {
          return state;
        }
        return {
          pendingAutoDownloads: [...state.pendingAutoDownloads, download],
        };
      });
    },
    removePendingAutoDownload: (cid: string) => {
      set((state) => ({
        pendingAutoDownloads: state.pendingAutoDownloads.filter(
          (d) => d.cid !== cid,
        ),
      }));
    },
  }),
);

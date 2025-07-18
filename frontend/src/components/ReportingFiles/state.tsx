import { create } from 'zustand';

interface ReportingFilesStore {
  asyncDownloads: string[];
  fetcher: (() => Promise<string[]>) | undefined;
  setFetcher: (fetcher: (() => Promise<string[]>) | undefined) => void;
  update: () => void;
}

export const useReportingFilesStore = create<ReportingFilesStore>(
  (set, get) => ({
    asyncDownloads: [],
    fetcher: undefined,
    setFetcher: (fetcher: (() => Promise<string[]>) | undefined) => {
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

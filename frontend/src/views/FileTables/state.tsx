import { create } from 'zustand';
import { ObjectSummary } from '../../models/UploadedObjectMetadata';

export const useFileTableState = create<{
  objects: ObjectSummary[] | null;
  total: number;
  page: number;
  limit: number;
  fetcher:
    | ((
        page: number,
        limit: number,
      ) => Promise<{ objects: ObjectSummary[]; total: number }>)
    | null;
  setObjects: (objects: ObjectSummary[] | null) => void;
  setFetcher: (
    fetcher: (
      page: number,
      limit: number,
    ) => Promise<{ objects: ObjectSummary[]; total: number }>,
  ) => void;
  fetch: () => void;
  setLimit: (limit: number) => void;
  setPage: (page: number) => void;
}>((set, get) => ({
  objects: null,
  total: 0,
  page: 0,
  limit: 5,
  setObjects: (objects: ObjectSummary[] | null) => set({ objects }),
  fetcher: null,
  setFetcher: (
    fetcher: (
      page: number,
      limit: number,
    ) => Promise<{ objects: ObjectSummary[]; total: number }>,
  ) => set({ fetcher }),
  fetch: () => {
    const { page, limit, fetcher } = get();
    fetcher?.(page, limit)?.then((e) =>
      set({ objects: e.objects, total: e.total }),
    );
  },
  setLimit: (limit: number) => {
    set({ limit });
    get().fetch();
  },
  setPage: (page: number) => {
    set({ page });
    get().fetch();
  },
}));

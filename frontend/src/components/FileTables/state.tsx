/* eslint-disable camelcase */
import { create } from 'zustand';
import { ObjectSummary } from 'models/UploadedObjectMetadata';
import { Metadata_Roots_Order_By, Order_By } from '../../../gql/graphql';

export interface Fetcher {
  (
    page: number,
    limit: number,
    sortBy: Metadata_Roots_Order_By,
  ): Promise<{ objects: ObjectSummary[]; total: number }>;
}

interface FileTableStore {
  sortBy: Metadata_Roots_Order_By;
  setSortBy: (sortBy: Metadata_Roots_Order_By) => void;
  objects: ObjectSummary[] | null;
  total: number;
  page: number;
  limit: number;
  fetcher: Fetcher | null;
  setObjects: (objects: ObjectSummary[] | null) => void;
  setFetcher: (fetcher: Fetcher) => void;
  fetch: () => void;
  setLimit: (limit: number) => void;
  setPage: (page: number) => void;
  setTotal: (total: number) => void;
  resetPagination: () => void;
}

export const useFileTableState = create<FileTableStore>()((set, get) => ({
  sortBy: {
    created_at: Order_By.DescNullsLast,
  },
  setSortBy: (sortBy: Metadata_Roots_Order_By) => {
    set({ sortBy, page: 0 });
    get().fetch();
  },
  objects: null,
  total: 0,
  page: 0,
  limit: 5,
  setObjects: (objects: ObjectSummary[] | null) => set({ objects }),
  setTotal: (total: number) => set({ total }),
  fetcher: null,
  setFetcher: (
    fetcher: (
      page: number,
      limit: number,
      sortBy: Metadata_Roots_Order_By,
    ) => Promise<{ objects: ObjectSummary[]; total: number }>,
  ) => set({ fetcher }),
  fetch: () => {
    const { page, limit, fetcher, sortBy } = get();
    fetcher?.(page, limit, sortBy)?.then((e) =>
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
  resetPagination: () => {
    set({ page: 0, limit: 5, sortBy: { created_at: Order_By.DescNullsLast } });
  },
}));

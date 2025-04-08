/* eslint-disable camelcase */
import { create } from 'zustand';
import { ObjectSummary } from '@auto-drive/models';
import { Metadata_Roots_Order_By, Order_By } from '../../../gql/graphql';
import { resetParams } from '@/utils/table';
import {
  TABLE_ROW_LIMITS,
  TABLE_SORT_KEYS,
  defaultParams,
} from '@/constants/table';

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
  initFromUrl: () => void;
  isInitialized: boolean;
  resetState: () => void;
}

export const useFileTableState = create<FileTableStore>()((set, get) => ({
  sortBy: defaultParams.sortBy,
  page: defaultParams.page,
  limit: defaultParams.limit,
  isInitialized: false,
  objects: null,
  total: 0,
  setSortBy: (sortBy: Metadata_Roots_Order_By) => {
    set({ sortBy, page: 0 });
    get().fetch();
  },
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
    set({
      ...defaultParams,
      isInitialized: true,
    });
    resetParams();
  },
  resetState: () => {
    set({
      ...defaultParams,
      objects: null,
      total: 0,
      fetcher: null,
      isInitialized: false
    });
    resetParams();
  },
  initFromUrl: () => {
    if (get().isInitialized) return;
    if (typeof window === 'undefined') return;

    try {
      const searchParams = new URLSearchParams(window.location.search);
      let paramsChanged = false;
      const state = get();

      let newPage = state.page;
      let newLimit = state.limit;
      let newSortBy = state.sortBy;

      const pageParam = searchParams.get('page');
      if (pageParam) {
        const parsedPage = parseInt(pageParam);
        if (!isNaN(parsedPage) && parsedPage > 0) {
          newPage = parsedPage - 1;
          paramsChanged = true;
        }
      }

      const limitParam = searchParams.get('limit');
      if (limitParam) {
        const parsedLimit = parseInt(limitParam);
        if (!isNaN(parsedLimit) && TABLE_ROW_LIMITS.includes(parsedLimit)) {
          newLimit = parsedLimit;
          paramsChanged = true;
        }
      }

      const sortKeyParam = searchParams.get('sortKey');
      const sortOrderParam = searchParams.get('sortOrder') as Order_By;

      if (
        sortKeyParam &&
        TABLE_SORT_KEYS.includes(sortKeyParam) &&
        (sortOrderParam === Order_By.AscNullsLast ||
          sortOrderParam === Order_By.DescNullsLast)
      ) {
        newSortBy = {
          [sortKeyParam]: sortOrderParam,
        } as Metadata_Roots_Order_By;
        paramsChanged = true;
      }

      if (paramsChanged) {
        set({
          page: newPage,
          limit: newLimit,
          sortBy: newSortBy,
          isInitialized: true,
        });
      } else {
        set({ isInitialized: true });
      }
    } catch (error) {
      set({ isInitialized: true });
      console.error('Error initializing table from URL:', error);
    }
  },
}));

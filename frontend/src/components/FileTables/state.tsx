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
    searchQuery: string,
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
  isLoading: boolean;
  resetState: () => void;
  searchQuery: string;
  setSearchQuery: (searchQuery: string) => void;
  currentRequestId: number;
}

export const useFileTableState = create<FileTableStore>()((set, get) => {
  return {
    sortBy: defaultParams.sortBy,
    page: defaultParams.page,
    limit: defaultParams.limit,
    isInitialized: false,
    isLoading: true,
    objects: null,
    total: 0,
    searchQuery: '',
    currentRequestId: 0,
    setSearchQuery: (searchQuery: string) => {
      set({ searchQuery, page: 0 });
      get().fetch();
    },
    setSortBy: (sortBy: Metadata_Roots_Order_By) => {
      set({ sortBy, page: 0 });
      get().fetch();
    },
    setObjects: (objects: ObjectSummary[] | null) => set({ objects }),
    setTotal: (total: number) => set({ total }),
    fetcher: null,
    setFetcher: (fetcher: Fetcher) => {
      set({ fetcher });
      get().fetch();
    },
    fetch: () => {
      const { page, limit, fetcher, sortBy, searchQuery, currentRequestId } =
        get();
      const requestId = currentRequestId + 1;

      set({ isLoading: true, currentRequestId: requestId });

      fetcher?.(page, limit, sortBy, searchQuery)
        ?.then((e) => {
          // Only update state if this is still the current request
          if (requestId === get().currentRequestId) {
            set({ objects: e.objects, total: e.total, isLoading: false });
          }
        })
        .catch(() => {
          // Ignore all errors, including aborted requests
        });
    },
    setLimit: (limit: number) => {
      const { page, total } = get();
      // Calculate new max valid page for the new limit
      const newTotalPages = Math.ceil(total / limit);
      // Ensure page is valid for the new limit (0-based index)
      const newPage = Math.min(page, Math.max(0, newTotalPages - 1));
      set({ limit, page: newPage });
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
        isInitialized: false,
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
  };
});

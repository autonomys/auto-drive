/* eslint-disable camelcase */
import { DEFAULT_PAGE_PARAM_UI } from '@/constants/table';
import { Order_By } from 'gql/graphql';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

export const resetParams = () => {
  // Also update URL when resetting pagination
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.searchParams.delete('page');
    url.searchParams.delete('limit');
    url.searchParams.delete('sortKey');
    url.searchParams.delete('sortOrder');
    window.history.replaceState({}, '', url);
  }
};

// Update URL parameters based on table state
export const updateUrlParams = (
  pathname: string,
  searchParams: URLSearchParams,
  page: number, // Internal 0-based page
  limit: number,
  router: AppRouterInstance,
) => {
  const params = new URLSearchParams(searchParams);

  // Convert internal 0-based page to UI 1-based page for URL
  params.set('page', String(page + 1));
  params.set('limit', String(limit));

  const newUrl = `${pathname}?${params.toString()}`;
  router.replace(newUrl, { scroll: false });
};

// Update URL with sort parameters
export const updateSortParams = (
  pathname: string,
  searchParams: URLSearchParams,
  sortKey: string,
  sortOrder: Order_By,
  router: AppRouterInstance,
) => {
  const params = new URLSearchParams(searchParams);

  params.set('sortKey', sortKey);
  params.set('sortOrder', sortOrder);

  // Reset to first page when sorting changes (use 1-based page number in URL)
  params.set('page', String(DEFAULT_PAGE_PARAM_UI));

  const newUrl = `${pathname}?${params.toString()}`;
  router.replace(newUrl, { scroll: false });
};

export const formatCid = (cid: string) => {
  if (cid.length <= 15) return cid;
  return `${cid.slice(0, 10)}...${cid.slice(-5)}`;
};

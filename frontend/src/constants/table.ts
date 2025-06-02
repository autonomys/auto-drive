/* eslint-disable camelcase */
import { Order_By } from 'gql/graphql';

export const TABLE_ROW_LIMITS = [10, 20, 50, 100];
export const TABLE_SORT_KEYS = ['name', 'size', 'created_at', 'updated_at'];
export const DEFAULT_PAGE_PARAM_INTERNAL = 0;
export const DEFAULT_PAGE_PARAM_UI = 1;
export const DEFAULT_LIMIT_PARAM = TABLE_ROW_LIMITS[0];

export const defaultParams = {
  page: DEFAULT_PAGE_PARAM_INTERNAL,
  limit: DEFAULT_LIMIT_PARAM,
  sortBy: { created_at: Order_By.DescNullsLast },
};

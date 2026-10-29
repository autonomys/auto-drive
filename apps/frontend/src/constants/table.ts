/* eslint-disable camelcase */
import { Order_By } from 'gql/graphql';

export const TABLE_ROW_LIMITS = [10, 20, 50, 100];
export const TABLE_SORT_KEYS = ['name', 'size', 'created_at', 'updated_at'];
// Earlier releases wrote the NULLS LAST variants into shared links.
export const TABLE_SORT_ORDER_FROM_PARAM = new Map<string, Order_By>([
  [Order_By.Asc, Order_By.Asc],
  [Order_By.AscNullsLast, Order_By.Asc],
  [Order_By.Desc, Order_By.Desc],
  [Order_By.DescNullsLast, Order_By.Desc],
]);
export const DEFAULT_PAGE_PARAM_INTERNAL = 0;
export const DEFAULT_PAGE_PARAM_UI = 1;
export const DEFAULT_LIMIT_PARAM = TABLE_ROW_LIMITS[0];

export const defaultParams = {
  page: DEFAULT_PAGE_PARAM_INTERNAL,
  limit: DEFAULT_LIMIT_PARAM,
  sortBy: { created_at: Order_By.Desc },
};

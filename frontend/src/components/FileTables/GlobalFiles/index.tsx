/* eslint-disable camelcase */
'use client';

import { useCallback, useEffect } from 'react';
import { FileTable, FileActionButtons } from '../common/FileTable';
import { NoUploadsPlaceholder } from '../common/NoUploadsPlaceholder';
import { SearchBar } from 'components/SearchBar';
import {
  GetGlobalFilesDocument,
  GetGlobalFilesQuery,
  useGetGlobalFilesQuery,
} from 'gql/graphql';
import { objectSummaryFromGlobalFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../state';
import { useNetwork } from 'contexts/network';

export const GlobalFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const sortBy = useFileTableState((e) => e.sortBy);
  const page = useFileTableState((e) => e.page);
  const limit = useFileTableState((e) => e.limit);
  const setTotal = useFileTableState((e) => e.setTotal);
  const searchQuery = useFileTableState((e) => e.searchQuery);
  const { gql } = useNetwork();

  const fetcher: Fetcher = useCallback(
    async (page, limit, sortBy, searchQuery) => {
      const { data } = await gql.query<GetGlobalFilesQuery>({
        query: GetGlobalFilesDocument,
        variables: {
          limit,
          offset: page * limit,
          orderBy: sortBy,
          search: `%${searchQuery}%`,
        },
        fetchPolicy: 'no-cache',
      });
      return {
        objects: objectSummaryFromGlobalFilesQuery(data),
        total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
      };
    },
    [gql],
  );

  useEffect(() => {
    setObjects(null);
    setFetcher(fetcher);
  }, [fetcher, gql, setFetcher, setObjects]);

  useGetGlobalFilesQuery({
    fetchPolicy: 'cache-and-network',
    variables: {
      limit,
      offset: page * limit,
      orderBy: sortBy,
      search: `%${searchQuery}%`,
    },
    onCompleted: (data) => {
      setObjects(objectSummaryFromGlobalFilesQuery(data));
      setTotal(data.metadata_roots_aggregate?.aggregate?.count ?? 0);
    },
    pollInterval: 30_000,
  });

  return (
    <div className='flex w-full'>
      <div className='flex w-full flex-col gap-4'>
        <div className='flex w-full items-center justify-start gap-4'>
          <div className='w-full max-w-md'>
            <SearchBar scope='global' />
          </div>
        </div>
        <div>
          <FileTable
            actionButtons={[
              FileActionButtons.DOWNLOAD,
              FileActionButtons.ASYNC_DOWNLOAD,
            ]}
            noFilesPlaceholder={<NoUploadsPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

/* eslint-disable camelcase */
'use client';

import { NoFilesInTrashPlaceholder } from './NoFilesInTrashPlaceholder';
import { FileActionButtons, FileTable } from '../common/FileTable';
import { useCallback, useEffect } from 'react';
import {
  GetTrashedFilesDocument,
  GetTrashedFilesQuery,
  useGetTrashedFilesQuery,
} from 'gql/graphql';
import { useUserStore } from 'states/user';
import { objectSummaryFromTrashedFilesQuery } from './utils';
import { useFileTableState } from '../state';
import { useNetwork } from 'contexts/network';

export const TrashFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const page = useFileTableState((e) => e.page);
  const limit = useFileTableState((e) => e.limit);
  const setTotal = useFileTableState((e) => e.setTotal);
  const resetPagination = useFileTableState((e) => e.resetPagination);

  const { gql } = useNetwork();
  const user = useUserStore((state) => state.user);

  const fetcher = useCallback(
    async (page: number, limit: number) => {
      const { data } = await gql.query<GetTrashedFilesQuery>({
        query: GetTrashedFilesDocument,
        variables: {
          limit,
          offset: page * limit,
          oauthUserId: user?.oauthUserId ?? '',
          oauthProvider: user?.oauthProvider ?? '',
        },
        fetchPolicy: 'no-cache',
      });

      return {
        objects: objectSummaryFromTrashedFilesQuery(data),
        total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
      };
    },
    [gql, user?.oauthProvider, user?.oauthUserId],
  );

  useEffect(() => {
    resetPagination();
    setObjects(null);
    setFetcher(fetcher);
  }, [fetcher, gql, resetPagination, setFetcher, setObjects]);

  useGetTrashedFilesQuery({
    fetchPolicy: 'cache-and-network',
    skip: !user,
    variables: {
      limit,
      offset: page * limit,
      oauthUserId: user?.oauthUserId ?? '',
      oauthProvider: user?.oauthProvider ?? '',
    },
    onCompleted: (data) => {
      setObjects(objectSummaryFromTrashedFilesQuery(data));
      setTotal(data.metadata_roots_aggregate?.aggregate?.count ?? 0);
    },
    pollInterval: 30_000,
  });

  return (
    <div className='flex w-full'>
      <div className='flex w-full flex-col gap-4'>
        <div className=''>
          <FileTable
            actionButtons={[
              FileActionButtons.DOWNLOAD,
              FileActionButtons.RESTORE,
            ]}
            noFilesPlaceholder={<NoFilesInTrashPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

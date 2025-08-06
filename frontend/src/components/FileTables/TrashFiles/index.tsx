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
import { useUserStore } from 'globalStates/user';
import { objectSummaryFromTrashedFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../state';
import { useNetwork } from 'contexts/network';

export const TrashFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const page = useFileTableState((e) => e.page);
  const limit = useFileTableState((e) => e.limit);
  const setTotal = useFileTableState((e) => e.setTotal);
  const sortBy = useFileTableState((e) => e.sortBy);
  const user = useUserStore((state) => state.user);

  const { gql } = useNetwork();

  const fetcher: Fetcher = useCallback(
    async (page, limit, sortBy) => {
      const { data } = await gql.query<GetTrashedFilesQuery>({
        query: GetTrashedFilesDocument,
        variables: {
          limit,
          offset: page * limit,
          oauthUserId: user?.oauthUserId ?? '',
          oauthProvider: user?.oauthProvider ?? '',
          orderBy: sortBy,
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
    setObjects(null);
    setFetcher(fetcher);
  }, [fetcher, gql, setFetcher, setObjects]);

  useGetTrashedFilesQuery({
    fetchPolicy: 'cache-and-network',
    skip: !user,
    variables: {
      limit,
      offset: page * limit,
      orderBy: sortBy,
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
              FileActionButtons.REPORT,
            ]}
            noFilesPlaceholder={<NoFilesInTrashPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

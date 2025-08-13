/* eslint-disable camelcase */
'use client';

import { NoFilesInTrashPlaceholder } from './NoFilesInTrashPlaceholder';
import { FileActionButtons, FileTable } from '../common/FileTable';
import { useCallback, useEffect } from 'react';
import { GetTrashedFilesDocument, GetTrashedFilesQuery } from 'gql/graphql';
import { useUserStore } from 'globalStates/user';
import { objectSummaryFromTrashedFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../state';
import { useNetwork } from 'contexts/network';

export const TrashFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const user = useUserStore((state) => state.user);
  const aggregateLimit = useFileTableState((e) => e.aggregateLimit);

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
          aggregateLimit,
        },
        fetchPolicy: 'no-cache',
      });

      return {
        objects: objectSummaryFromTrashedFilesQuery(data),
        total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
      };
    },
    [gql, user?.oauthProvider, user?.oauthUserId, aggregateLimit],
  );

  useEffect(() => {
    setObjects(null);
    setFetcher(fetcher);
  }, [fetcher, gql, setFetcher, setObjects]);

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

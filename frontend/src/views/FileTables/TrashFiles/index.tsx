/* eslint-disable camelcase */
'use client';

import { NoFilesInTrashPlaceholder } from './NoFilesInTrashPlaceholder';
import {
  FileActionButtons,
  FileTable,
} from '../../../components/common/FileTable';
import { useCallback, useEffect } from 'react';
import {
  GetTrashedFilesDocument,
  GetTrashedFilesQuery,
} from '../../../../gql/graphql';
import { useUserStore } from '../../../states/user';
import { objectSummaryFromTrashedFilesQuery } from './utils';
import { useFileTableState } from '../state';
import { useNetwork } from '../../../contexts/network';

export const TrashFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const fetch = useFileTableState((e) => e.fetch);
  const objects = useFileTableState((e) => e.objects);
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
  }, [fetcher, gql, setFetcher, setObjects]);

  useEffect(() => {
    console.log(objects);
  }, [objects]);

  useEffect(() => {
    fetch();
  }, [fetch]);

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

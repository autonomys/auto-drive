/* eslint-disable camelcase */
'use client';

import { useCallback, useEffect } from 'react';
import { useUserStore } from '../../../states/user';
import { FileDropZone } from '../../../components/Files/FileDropZone';
import { SearchBar } from '../../../components/SearchBar';
import {
  FileActionButtons,
  FileTable,
} from '../../../components/common/FileTable';
import { NoUploadsPlaceholder } from '../../../components/Files/NoUploadsPlaceholder';
import { GetMyFilesDocument, GetMyFilesQuery } from '../../../../gql/graphql';
import { objectSummaryFromUserFilesQuery } from './utils';
import { useFileTableState } from '../state';
import { useNetwork } from '../../../contexts/network';

export const UserFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const fetch = useFileTableState((e) => e.fetch);
  const objects = useFileTableState((e) => e.objects);
  const resetPagination = useFileTableState((e) => e.resetPagination);
  const { gql } = useNetwork();
  const user = useUserStore((state) => state.user);

  const fetcher = useCallback(
    async (page: number, limit: number) => {
      const { data } = await gql.query<GetMyFilesQuery>({
        query: GetMyFilesDocument,
        variables: {
          limit,
          offset: page * limit,
          oauthUserId: user?.oauthUserId ?? '',
          oauthProvider: user?.oauthProvider ?? '',
        },
        fetchPolicy: 'no-cache',
      });

      return {
        objects: objectSummaryFromUserFilesQuery(data),
        total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
      };
    },
    [gql, user?.oauthProvider, user?.oauthUserId],
  );

  useEffect(() => {
    resetPagination();
    setObjects(null);
    setFetcher(fetcher);
  }, [fetcher, gql, setFetcher, setObjects, resetPagination]);

  useEffect(() => {
    console.log(objects);
  }, [objects]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <div className='flex w-full'>
      <div className='flex w-full flex-col gap-4'>
        <div className='flex-1'>
          <FileDropZone />
        </div>
        <div className='w-full max-w-md'>
          <SearchBar scope='user' />
        </div>
        <div className=''>
          <FileTable
            actionButtons={[
              FileActionButtons.DOWNLOAD,
              FileActionButtons.SHARE,
              FileActionButtons.DELETE,
            ]}
            noFilesPlaceholder={<NoUploadsPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

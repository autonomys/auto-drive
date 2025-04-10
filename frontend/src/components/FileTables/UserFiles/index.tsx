/* eslint-disable camelcase */
'use client';

import { useCallback, useEffect } from 'react';
import { useUserStore } from 'globalStates/user';
import { FileDropZone } from '@/components/FileTables/common/FileDropZone';
import { SearchBar } from 'components/SearchBar';
import {
  FileActionButtons,
  FileTable,
} from '@/components/FileTables/common/FileTable';
import { NoUploadsPlaceholder } from '@/components/FileTables/common/NoUploadsPlaceholder';
import {
  GetMyFilesDocument,
  GetMyFilesQuery,
  useGetMyFilesQuery,
} from 'gql/graphql';
import { objectSummaryFromUserFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../state';
import { useNetwork } from 'contexts/network';

export const UserFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setTotal = useFileTableState((e) => e.setTotal);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const limit = useFileTableState((e) => e.limit);
  const page = useFileTableState((e) => e.page);
  const sortBy = useFileTableState((e) => e.sortBy);
  const user = useUserStore((state) => state.user);

  const { gql } = useNetwork();

  const fetcher: Fetcher = useCallback(
    async (page, limit, sortBy) => {
      const { data } = await gql.query<GetMyFilesQuery>({
        query: GetMyFilesDocument,
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
        objects: objectSummaryFromUserFilesQuery(data),
        total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
      };
    },
    [gql, user?.oauthProvider, user?.oauthUserId],
  );

  useEffect(() => {
    setObjects(null);
    setFetcher(fetcher);
  }, [fetcher, gql, setFetcher, setObjects]);

  useGetMyFilesQuery({
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
      setObjects(objectSummaryFromUserFilesQuery(data));
      setTotal(data.metadata_roots_aggregate?.aggregate?.count ?? 0);
    },
    pollInterval: 30_000,
  });

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

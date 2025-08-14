/* eslint-disable camelcase */
'use client';

import { useCallback, useEffect } from 'react';
import { useUserStore } from 'globalStates/user';
import { SearchBar } from 'components/SearchBar';
import {
  FileActionButtons,
  FileTable,
} from '@/components/FileTables/common/FileTable';
import { NoUploadsPlaceholder } from '@/components/FileTables/common/NoUploadsPlaceholder';
import { GetMyFilesDocument, GetMyFilesQuery } from 'gql/graphql';
import { objectSummaryFromUserFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../state';
import { useNetwork } from 'contexts/network';
import { UploadButton } from '../../UploadButton';
import { UserAsyncDownloads } from '../../UserAsyncDownloads';
import { ToBeReviewedFiles } from '../../FilesToBeReviewed';

export const UserFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const user = useUserStore((state) => state.user);
  const aggregateLimit = useFileTableState((e) => e.aggregateLimit);
  const { gql } = useNetwork();

  const fetcher: Fetcher = useCallback(
    async (page, limit, sortBy, searchQuery) => {
      const { data } = await gql.query<GetMyFilesQuery>({
        query: GetMyFilesDocument,
        variables: {
          limit,
          offset: page * limit,
          oauthUserId: user?.oauthUserId ?? '',
          oauthProvider: user?.oauthProvider ?? '',
          orderBy: sortBy,
          search: `%${searchQuery}%`,
          aggregateLimit,
        },
        fetchPolicy: 'no-cache',
      });

      return {
        objects: objectSummaryFromUserFilesQuery(data),
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
        <UserAsyncDownloads />
        <ToBeReviewedFiles />
        <div className='flex w-full flex-row items-center justify-between gap-4'>
          <SearchBar scope='user' />
          <UploadButton />
        </div>
        <div className=''>
          <FileTable
            actionButtons={[
              FileActionButtons.DOWNLOAD,
              FileActionButtons.SHARE,
              FileActionButtons.ASYNC_DOWNLOAD,
              FileActionButtons.DELETE,
              FileActionButtons.REPORT,
            ]}
            noFilesPlaceholder={<NoUploadsPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

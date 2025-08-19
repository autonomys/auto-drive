/* eslint-disable camelcase */
'use client';

import { useCallback, useEffect } from 'react';
import { FileTable, FileActionButtons } from '../../organisms/FileTable';
import { NoUploadsPlaceholder } from '../../molecules/NoUploadsPlaceholder';
import { SearchBar } from '@/components/molecules/SearchBar';
import { GetGlobalFilesDocument, GetGlobalFilesQuery } from 'gql/graphql';
import { objectSummaryFromGlobalFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../../organisms/FileTable/state';
import { useNetwork } from 'contexts/network';
import { UserAsyncDownloads } from '../../organisms/UserAsyncDownloads';
import { ToBeReviewedFiles } from '../../organisms/FilesToBeReviewed';

export const GlobalFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const aggregateLimit = useFileTableState((e) => e.aggregateLimit);
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
          aggregateLimit,
        },
        fetchPolicy: 'no-cache',
      });
      return {
        objects: objectSummaryFromGlobalFilesQuery(data),
        total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
      };
    },
    [gql, aggregateLimit],
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
              FileActionButtons.REPORT,
            ]}
            noFilesPlaceholder={<NoUploadsPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

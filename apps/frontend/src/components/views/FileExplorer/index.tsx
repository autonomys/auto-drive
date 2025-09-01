/* eslint-disable camelcase */
'use client';

import { useCallback, useEffect } from 'react';
import { FileTable, FileActionButtons } from '../../organisms/FileTable';
import { SearchBar } from '@/components/molecules/SearchBar';
import { GetGlobalFilesDocument, GetGlobalFilesQuery } from 'gql/graphql';
import { objectSummaryFromGlobalFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../../organisms/FileTable/state';
import { useNetwork } from 'contexts/network';
import { FileExplorerHeader } from './FileExplorerHeader';
import { NetworkDropdown } from '../../molecules/NetworkDropdown';
import { NoFilesPlaceholder } from '../../molecules/NoFilesPlaceholder';
import { ROUTES } from '@auto-drive/ui';

export const FileExplorer = () => {
  const { network } = useNetwork();
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
    <div className='flex w-full flex-col'>
      <FileExplorerHeader />
      <div className='flex w-full flex-col gap-4 px-20 py-10'>
        <div className='flex w-full items-center justify-between gap-4'>
          <SearchBar scope='global' />
          <NetworkDropdown
            selected={network}
            onChange={(network) => {
              window.location.assign(`/${network.id}/explorer`);
            }}
          />
        </div>
        <FileTable
          actionButtons={[FileActionButtons.DOWNLOAD, FileActionButtons.REPORT]}
          noFilesPlaceholder={<NoFilesPlaceholder />}
          fileDetailPath={ROUTES.publicFileDetails}
        />
      </div>
    </div>
  );
};

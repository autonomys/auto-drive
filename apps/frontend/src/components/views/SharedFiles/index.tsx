/* eslint-disable camelcase */
import { FileActionButtons, FileTable } from '../../organisms/FileTable';
import { NoSharedFilesPlaceholder } from './NoSharedFilesPlaceholder';
import { useCallback, useEffect } from 'react';
import { GetSharedFilesDocument, GetSharedFilesQuery } from 'gql/graphql';
import { objectSummaryFromSharedFilesQuery } from './utils';
import { Fetcher, useFileTableState } from '../../organisms/FileTable/state';
import { useNetwork } from 'contexts/network';
import { useUserStore } from 'globalStates/user';

export const SharedFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const aggregateLimit = useFileTableState((e) => e.aggregateLimit);
  const user = useUserStore((state) => state.user);
  const { gql } = useNetwork();

  const fetcher: Fetcher = useCallback(
    async (page: number, limit: number, sortBy) => {
      const { data } = await gql.query<GetSharedFilesQuery>({
        query: GetSharedFilesDocument,
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
        objects: objectSummaryFromSharedFilesQuery(data),
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
              FileActionButtons.DELETE,
              FileActionButtons.REPORT,
            ]}
            noFilesPlaceholder={<NoSharedFilesPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

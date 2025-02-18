/* eslint-disable camelcase */
import {
  FileActionButtons,
  FileTable,
} from '../../../components/common/FileTable';
import { NoSharedFilesPlaceholder } from './NoSharedFilesPlaceholder';
import { useCallback, useEffect } from 'react';
import {
  GetSharedFilesDocument,
  GetSharedFilesQuery,
  useGetSharedFilesQuery,
} from '../../../../gql/graphql';
import { objectSummaryFromSharedFilesQuery } from './utils';
import { useFileTableState } from '../state';
import { useNetwork } from '../../../contexts/network';
import { useUserStore } from '../../../states/user';

export const SharedFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const setTotal = useFileTableState((e) => e.setTotal);
  const limit = useFileTableState((e) => e.limit);
  const page = useFileTableState((e) => e.page);

  const resetPagination = useFileTableState((e) => e.resetPagination);

  const { gql } = useNetwork();
  const user = useUserStore((state) => state.user);

  const fetcher = useCallback(
    async (page: number, limit: number) => {
      const { data } = await gql.query<GetSharedFilesQuery>({
        query: GetSharedFilesDocument,
        variables: {
          limit,
          offset: page * limit,
          oauthUserId: user?.oauthUserId ?? '',
          oauthProvider: user?.oauthProvider ?? '',
        },
        fetchPolicy: 'no-cache',
      });

      return {
        objects: objectSummaryFromSharedFilesQuery(data),
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

  useGetSharedFilesQuery({
    fetchPolicy: 'cache-and-network',
    variables: {
      limit,
      offset: page * limit,
      oauthUserId: user?.oauthUserId ?? '',
      oauthProvider: user?.oauthProvider ?? '',
    },
    onCompleted: (data) => {
      setObjects(objectSummaryFromSharedFilesQuery(data));
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
              FileActionButtons.DELETE,
            ]}
            noFilesPlaceholder={<NoSharedFilesPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

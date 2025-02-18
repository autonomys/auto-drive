/* eslint-disable camelcase */
'use client';

import { useCallback, useEffect } from 'react';
import {
  FileTable,
  FileActionButtons,
} from '../../../components/common/FileTable';
import { NoUploadsPlaceholder } from '../../../components/Files/NoUploadsPlaceholder';
import { SearchBar } from '../../../components/SearchBar';
import {
  GetGlobalFilesDocument,
  GetGlobalFilesQuery,
} from '../../../../gql/graphql';
import { objectSummaryFromGlobalFilesQuery } from './utils';
import { useFileTableState } from '../state';
import { useNetwork } from '../../../contexts/network';
import { ApolloClient } from '@apollo/client';

export const GlobalFiles = () => {
  const setObjects = useFileTableState((e) => e.setObjects);
  const setFetcher = useFileTableState((e) => e.setFetcher);
  const fetch = useFileTableState((e) => e.fetch);
  const objects = useFileTableState((e) => e.objects);
  const resetPagination = useFileTableState((e) => e.resetPagination);
  const { gql } = useNetwork();

  const fetcher = useCallback(
    async (page: number, limit: number) => {
      const { data } = await gql.query<GetGlobalFilesQuery>({
        query: GetGlobalFilesDocument,
        variables: {
          limit,
          offset: page * limit,
        },
        fetchPolicy: 'no-cache',
      });

      return {
        objects: objectSummaryFromGlobalFilesQuery(data),
        total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
      };
    },
    [gql],
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
        <div className='flex w-full items-center justify-start gap-4'>
          <div className='w-full max-w-md'>
            <SearchBar scope='global' />
          </div>
        </div>
        <div>
          <FileTable
            actionButtons={[FileActionButtons.DOWNLOAD]}
            noFilesPlaceholder={<NoUploadsPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

export const createFetcher =
  (gql: ApolloClient<object>) => async (page: number, limit: number) => {
    const { data } = await gql.query<GetGlobalFilesQuery>({
      query: GetGlobalFilesDocument,
      variables: {
        limit,
        offset: page * limit,
      },
    });

    return {
      objects: objectSummaryFromGlobalFilesQuery(data),
      total: data.metadata_roots_aggregate?.aggregate?.count ?? 0,
    };
  };

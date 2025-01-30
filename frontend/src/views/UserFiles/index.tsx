'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUserStore } from '../../states/user';
import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import { PaginatedResult } from '../../models/common';
import { FileDropZone } from '../../components/Files/FileDropZone';
import { SearchBar } from '../../components/SearchBar';
import {
  FileActionButtons,
  FileTable,
} from '../../components/common/FileTable';
import { NoUploadsPlaceholder } from '../../components/Files/NoUploadsPlaceholder';
import { useGetMyFilesQuery } from '../../../gql/graphql';
import { useSession } from 'next-auth/react';
import { objectSummaryFromUserFilesQuery } from './utils';

export const UserFiles = () => {
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const user = useUserStore((state) => state.user);

  const [objects, setObjects] = useState<ObjectSummary[] | null>(null);

  const updateResult = useCallback((result: PaginatedResult<ObjectSummary>) => {
    setObjects(result.rows);
    setTotalItems(result.totalCount);
  }, []);

  const updateCurrentPage = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  const updatePageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
  }, []);

  const session = useSession();

  const { data, loading } = useGetMyFilesQuery({
    variables: {
      oauthUserId: user?.oauthUserId ?? '',
      oauthProvider: user?.oauthProvider ?? '',
      limit: pageSize,
      offset: currentPage * pageSize,
    },
    skip: !user || !session.data,
    fetchPolicy: 'no-cache',
  });

  useEffect(() => {
    if (data) {
      console.log(data);
      updateResult({
        rows: objectSummaryFromUserFilesQuery(data),
        totalCount: data.metadata_aggregate.aggregate?.count ?? 0,
      });
    }
  }, [data, updateResult]);

  useEffect(() => {
    if (loading) {
      setObjects(null);
    }
  }, [loading]);

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
            files={objects}
            pageSize={pageSize}
            setPageSize={updatePageSize}
            currentPage={currentPage}
            setCurrentPage={updateCurrentPage}
            totalItems={totalItems}
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

'use client';

import { LoaderCircle } from 'lucide-react';
import { useState, useCallback } from 'react';
import {
  FileTable,
  FileActionButtons,
} from '../../components/common/FileTable';
import { NoUploadsPlaceholder } from '../../components/Files/NoUploadsPlaceholder';
import { UploadingObjects } from '../../components/Files/UploadingObjects';
import { SearchBar } from '../../components/SearchBar';
import { PaginatedResult } from '../../models/common';
import { useGetGlobalFilesQuery } from '../../../gql/graphql';
import { objectSummaryFromGlobalFilesQuery } from './utils';
import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import { useSession } from 'next-auth/react';

export const GlobalFiles = () => {
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const [rootObjectMetadata, setRootObjectMetadata] = useState<
    ObjectSummary[] | null
  >(null);

  const updateResult = useCallback((result: PaginatedResult<ObjectSummary>) => {
    setRootObjectMetadata(result.rows);
    setTotalItems(result.totalCount);
  }, []);

  const updateCurrentPage = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  const updatePageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
  }, []);

  const session = useSession();

  useGetGlobalFilesQuery({
    variables: {
      limit: pageSize,
      offset: currentPage * pageSize,
    },
    onCompleted: (data) => {
      updateResult({
        rows: objectSummaryFromGlobalFilesQuery(data),
        totalCount: data.metadata_aggregate?.aggregate?.count ?? 0,
      });
    },
    skip: !session.data?.accessToken,
    context: {
      headers: {
        Authorization: `Bearer ${session.data?.accessToken}`,
      },
    },
  });

  return (
    <div className='flex w-full'>
      <div className='flex w-full flex-col gap-4'>
        <div className='flex w-full items-center justify-start gap-4'>
          <div className='w-full max-w-md'>
            <SearchBar scope='global' />
          </div>
        </div>
        <div className=''>
          <UploadingObjects />
          {rootObjectMetadata === null && (
            <div className='flex min-h-[50vh] items-center justify-center'>
              <LoaderCircle className='h-10 w-10 animate-spin' />
            </div>
          )}
          {rootObjectMetadata && rootObjectMetadata.length > 0 && (
            <FileTable
              files={rootObjectMetadata}
              pageSize={pageSize}
              setPageSize={updatePageSize}
              currentPage={currentPage}
              setCurrentPage={updateCurrentPage}
              totalItems={totalItems}
              actionButtons={[FileActionButtons.DOWNLOAD]}
            />
          )}
          {rootObjectMetadata && rootObjectMetadata.length === 0 && (
            <NoUploadsPlaceholder />
          )}
        </div>
      </div>
    </div>
  );
};

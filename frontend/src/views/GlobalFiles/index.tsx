'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  FileTable,
  FileActionButtons,
} from '../../components/common/FileTable';
import { NoUploadsPlaceholder } from '../../components/Files/NoUploadsPlaceholder';
import { SearchBar } from '../../components/SearchBar';
import { PaginatedResult } from '../../models/common';
import { useGetGlobalFilesQuery } from '../../../gql/graphql';
import { objectSummaryFromGlobalFilesQuery } from './utils';
import { ObjectSummary } from '../../models/UploadedObjectMetadata';

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

  const { data, loading } = useGetGlobalFilesQuery({
    variables: {
      limit: pageSize,
      offset: currentPage * pageSize,
    },
  });

  useEffect(() => {
    if (data) {
      updateResult({
        rows: objectSummaryFromGlobalFilesQuery(data),
        totalCount: data.metadata_aggregate?.aggregate?.count ?? 0,
      });
    }
  }, [data, updateResult]);

  useEffect(() => {
    if (loading) {
      setRootObjectMetadata(null);
    }
  }, [loading]);

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
            files={rootObjectMetadata}
            pageSize={pageSize}
            setPageSize={updatePageSize}
            currentPage={currentPage}
            setCurrentPage={updateCurrentPage}
            totalItems={totalItems}
            actionButtons={[FileActionButtons.DOWNLOAD]}
            noFilesPlaceholder={<NoUploadsPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

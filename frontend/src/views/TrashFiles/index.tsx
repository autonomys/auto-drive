/* eslint-disable camelcase */
'use client';

import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import { NoFilesInTrashPlaceholder } from './NoFilesInTrashPlaceholder';
import {
  FileActionButtons,
  FileTable,
} from '../../components/common/FileTable';
import { useCallback, useEffect, useState } from 'react';
import { PaginatedResult } from '../../models/common';
import { Order_By, useGetTrashedFilesQuery } from '../../../gql/graphql';
import { useUserStore } from '../../states/user';
import { objectSummaryFromTrashedFilesQuery } from './utils';

export const TrashFiles = () => {
  const [objects, setObjects] = useState<ObjectSummary[] | null>(null);
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const user = useUserStore(({ user }) => user);

  const updateResult = useCallback((result: PaginatedResult<ObjectSummary>) => {
    setObjects(result.rows);
    setTotalItems(result.totalCount);
  }, []);

  const updatePageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
  }, []);

  const updateCurrentPage = useCallback((newCurrentPage: number) => {
    setCurrentPage(newCurrentPage);
  }, []);

  const { data, loading } = useGetTrashedFilesQuery({
    variables: {
      oauthUserId: user!.oauthUserId,
      oauthProvider: user!.oauthProvider,
      limit: pageSize,
      offset: currentPage * pageSize,
      orderBy: [{ created_at: Order_By.DescNullsLast }],
    },
    skip: !user,
  });

  useEffect(() => {
    if (loading) {
      setObjects(null);
    }
  }, [loading]);

  useEffect(() => {
    if (data) {
      updateResult({
        rows: objectSummaryFromTrashedFilesQuery(data),
        totalCount: data.metadata_roots_aggregate.aggregate?.count ?? 0,
      });
    }
  }, [data, updateResult]);

  return (
    <div className='flex w-full'>
      <div className='flex w-full flex-col gap-4'>
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
              FileActionButtons.RESTORE,
            ]}
            noFilesPlaceholder={<NoFilesInTrashPlaceholder />}
          />
        </div>
      </div>
    </div>
  );
};

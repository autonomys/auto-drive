'use client';

import { LoaderCircle } from 'lucide-react';
import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import { UploadingObjects } from '../../components/Files/UploadingObjects';
import { NoFilesInTrashPlaceholder } from './NoFilesInTrashPlaceholder';
import {
  FileActionButtons,
  FileTable,
} from '../../components/common/FileTable';
import { useCallback, useState } from 'react';
import { PaginatedResult } from '../../models/common';
import { useGetTrashedFilesQuery } from '../../../gql/graphql';
import { useUserStore } from '../../states/user';
import { useSession } from 'next-auth/react';
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

  const session = useSession();

  useGetTrashedFilesQuery({
    variables: {
      oauthUserId: user!.oauthUserId,
      oauthProvider: user!.oauthProvider,
      limit: pageSize,
      offset: currentPage * pageSize,
    },
    skip: !user,
    onCompleted: (data) => {
      updateResult({
        rows: objectSummaryFromTrashedFilesQuery(data),
        totalCount: data.metadata_aggregate.aggregate?.count ?? 0,
      });
    },
    context: {
      headers: {
        Authorization: `Bearer ${session.data?.accessToken}`,
      },
    },
  });

  return (
    <div className='flex w-full'>
      <div className='flex w-full flex-col gap-4'>
        <div className=''>
          <UploadingObjects />
          {objects === null && (
            <div className='flex min-h-[50vh] items-center justify-center'>
              <LoaderCircle className='h-10 w-10 animate-spin' />
            </div>
          )}
          {objects && objects.length > 0 && (
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
            />
          )}
          {objects && objects.length === 0 && <NoFilesInTrashPlaceholder />}
        </div>
      </div>
    </div>
  );
};

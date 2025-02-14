/* eslint-disable camelcase */
import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import {
  FileActionButtons,
  FileTable,
} from '../../components/common/FileTable';
import { NoSharedFilesPlaceholder } from './NoSharedFilesPlaceholder';
import { useCallback, useEffect, useState } from 'react';
import { PaginatedResult } from '../../models/common';
import { Order_By, useGetSharedFilesQuery } from '../../../gql/graphql';
import { useUserStore } from '../../states/user';
import { objectSummaryFromSharedFilesQuery } from './utils';

export const SharedFiles = () => {
  const user = useUserStore(({ user }) => user);
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const [objects, setObjects] = useState<ObjectSummary[] | null>(null);

  const updateResult = useCallback((result: PaginatedResult<ObjectSummary>) => {
    setObjects(result.rows);
    setTotalItems(result.totalCount);
  }, []);

  const { data, loading } = useGetSharedFilesQuery({
    variables: {
      oauthUserId: user?.oauthUserId ?? '',
      oauthProvider: user?.oauthProvider ?? '',
      limit: pageSize,
      offset: currentPage * pageSize,
      orderBy: [{ created_at: Order_By.DescNullsLast }],
    },
    skip: !user,
  });

  useEffect(() => {
    if (data) {
      updateResult({
        rows: objectSummaryFromSharedFilesQuery(data),
        totalCount: data.metadata_roots_aggregate.aggregate?.count ?? 0,
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
        <div className=''>
          <FileTable
            files={objects}
            pageSize={pageSize}
            setPageSize={setPageSize}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            totalItems={totalItems}
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

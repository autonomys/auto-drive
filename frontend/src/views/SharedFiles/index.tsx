import { LoaderCircle } from 'lucide-react';
import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import {
  FileActionButtons,
  FileTable,
} from '../../components/common/FileTable';
import { UploadingObjects } from '../../components/Files/UploadingObjects';
import { NoSharedFilesPlaceholder } from './NoSharedFilesPlaceholder';
import { useCallback, useState } from 'react';
import { PaginatedResult } from '../../models/common';
import { useGetSharedFilesQuery } from '../../../gql/graphql';
import { useSession } from 'next-auth/react';
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

  const session = useSession();

  useGetSharedFilesQuery({
    variables: {
      oauthUserId: user?.oauthUserId ?? '',
      oauthProvider: user?.oauthProvider ?? '',
      limit: pageSize,
      offset: currentPage * pageSize,
    },
    skip: !user || !session.data,
    context: {
      headers: {
        Authorization: `Bearer ${session.data?.accessToken}`,
      },
    },
    onCompleted(data) {
      updateResult({
        rows: objectSummaryFromSharedFilesQuery(data),
        totalCount: data.metadata_aggregate.aggregate?.count ?? 0,
      });
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
              setPageSize={setPageSize}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              totalItems={totalItems}
              actionButtons={[
                FileActionButtons.DOWNLOAD,
                FileActionButtons.DELETE,
              ]}
            />
          )}
          {objects && objects.length === 0 && <NoSharedFilesPlaceholder />}
        </div>
      </div>
    </div>
  );
};

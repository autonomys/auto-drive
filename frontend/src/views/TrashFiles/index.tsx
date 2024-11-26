'use client';

import { LoaderCircle } from 'lucide-react';
import { ObjectSummary, OwnerRole } from '../../models/UploadedObjectMetadata';
import { UploadingObjects } from '../../components/Files/UploadingObjects';
import { NoFilesInTrashPlaceholder } from './NoFilesInTrashPlaceholder';
import {
  FileActionButtons,
  FileTable,
} from '../../components/common/FileTable';
import { useCallback, useState } from 'react';
import { PaginatedResult } from '../../models/common';
import {
  GetTrashedFilesQuery,
  useGetTrashedFilesQuery,
} from '../../../gql/graphql';
import { useUserStore } from '../../states/user';
import { useSession } from 'next-auth/react';

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

  const parseQueryResultIntoFileSummaries = useCallback(
    (e: GetTrashedFilesQuery): ObjectSummary[] => {
      return e.metadata.map((m) => ({
        headCid: m.root_metadata!.cid,
        size: m.root_metadata?.size ?? 0,
        owners: m.root_metadata!.object_ownership.map((o) => ({
          publicId: o.user?.public_id ?? '',
          role: o.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
        })),
        type: m.root_metadata?.type,
        name: m.root_metadata?.name,
        mimeType: m.root_metadata?.mimeType,
        children: m.root_metadata?.children,
        uploadStatus: {
          uploadedNodes: m.root_metadata!.publishedNodes.aggregate?.count ?? 0,
          archivedNodes: m.root_metadata!.archivedNodes.aggregate?.count ?? 0,
          totalNodes: m.root_metadata!.totalNodes.aggregate?.count ?? 0,
          minimumBlockDepth:
            m.root_metadata!.minimumBlockDepth[0].transaction_result
              ?.blockNumber ?? null,
          maximumBlockDepth:
            m.root_metadata!.maximumBlockDepth[0].transaction_result
              ?.blockNumber ?? null,
        },
      }));
    },
    [],
  );

  const session = useSession();

  const { loading } = useGetTrashedFilesQuery({
    variables: {
      oauthUserId: user!.oauthUserId,
      oauthProvider: user!.oauthProvider,
      limit: pageSize,
      offset: currentPage * pageSize,
    },
    skip: !user,
    onCompleted: (data) => {
      updateResult({
        rows: parseQueryResultIntoFileSummaries(data),
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

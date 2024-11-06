import { LoaderCircle } from 'lucide-react';
import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import { UploadingObjects } from '../Files/UploadingObjects';
import { NoFilesInTrashPlaceholder } from './NoFilesInTrashPlaceholder';
import { FileActionButtons, FileTable } from '../common/FileTable';

export const TrashFiles = ({
  objects,
  pageSize,
  setPageSize,
  currentPage,
  setCurrentPage,
  totalItems,
}: {
  objects: ObjectSummary[] | null;
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  currentPage: number;
  setCurrentPage: (currentPage: number) => void;
  totalItems: number;
}) => {
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

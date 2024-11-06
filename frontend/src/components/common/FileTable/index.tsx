'use client';

import { ObjectSummary } from '@/models/UploadedObjectMetadata';
import {
  Checkbox,
  Transition,
} from '@headlessui/react';
import { Square, SquareCheck } from 'lucide-react';
import {
  FC,
  useCallback,
  useState,
} from 'react';
import { ObjectShareModal } from '../../Files/ObjectShareModal';
import { ObjectDeleteModal } from '../../Files/ObjectDeleteModal';
import { ObjectDownloadModal } from '../../Files/ObjectDownloadModal';
import { useUserStore } from '../../../states/user';
import { Table } from '../Table';
import { TableHead, TableHeadCell, TableHeadRow } from '../Table/TableHead';
import { TableBody } from '../Table/TableBody';
import { Button } from '../Button';
import { TableFooter } from '../Table/TableFooter';
import { TablePaginator } from '../TablePaginator';
import { ObjectRestoreModal } from '../../Files/ObjectRestoreModal';
import { FileTableRow } from './FileTableRow';

export enum FileActionButtons {
  DOWNLOAD = 'download',
  SHARE = 'share',
  DELETE = 'delete',
  RESTORE = 'restore',
}

export const FileTable: FC<{
  files: ObjectSummary[];
  pageSize: number;
  setPageSize: (pageSize: number) => void;
  currentPage: number;
  setCurrentPage: (currentPage: number) => void;
  totalItems: number;
  actionButtons: FileActionButtons[];
}> = ({
  files,
  pageSize,
  setPageSize,
  currentPage,
  setCurrentPage,
  totalItems,
  actionButtons,
}) => {
  const user = useUserStore(({ user }) => user);
  const [downloadingCID, setDownloadingCID] = useState<string | null>(null);
  const [shareCID, setShareCID] = useState<string | null>(null);
  const [restoreCID, setRestoreCID] = useState<string | null>(null);
  const [deleteCID, setDeleteCID] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  const onClose = useCallback(() => {
    setShareCID(null);
    setDeleteCID(null);
    setDownloadingCID(null);
    setRestoreCID(null);
  }, []);

  const toggleSelectFile = useCallback((cid: string) => {
    setSelectedFiles((prev) =>
      prev.some((f) => f === cid)
        ? prev.filter((f) => f !== cid)
        : [...prev, cid],
    );
  }, []);

  return (
    <div className='flex flex-col'>
      <ObjectShareModal cid={shareCID} closeModal={() => setShareCID(null)} />
      <ObjectDeleteModal
        cid={deleteCID}
        closeModal={() => setDeleteCID(null)}
      />
      <ObjectDownloadModal cid={downloadingCID} onClose={onClose} />
      <ObjectRestoreModal cid={restoreCID} closeModal={onClose} />
      <div className='-my-2 sm:-mx-6 lg:-mx-8'>
        <div className='inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8'>
          <div className='mb-4 ml-2 flex items-center justify-start gap-2'>
            <div className='flex h-8 items-center'>
              <Checkbox
                className='transition-all duration-200 hover:scale-105 hover:cursor-pointer'
                checked={selectedFiles.length > 0}
                onChange={() =>
                  selectedFiles.length > 0
                    ? setSelectedFiles([])
                    : setSelectedFiles(
                        files.map((f) => f.headCid),
                      )
                }
              >
                {selectedFiles.length > 0 ? <SquareCheck /> : <Square />}
              </Checkbox>
            </div>
            <Transition
              show={selectedFiles.length > 0}
              enter='transition ease-out duration-100'
              enterFrom='opacity-0'
              enterTo='opacity-100'
              leave='transition ease-in duration-75'
              leaveFrom='opacity-100'
              leaveTo='opacity-0'
            >
              <div className='contents'>
                <span className='text-sm font-semibold'>
                  {selectedFiles.length} files selected
                </span>
                <Button className='text-xs' variant='lightAccent'>
                  Download
                </Button>
              </div>
            </Transition>
          </div>
          <Table>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Root CID</TableHeadCell>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell>Size</TableHeadCell>
                <TableHeadCell>Owner</TableHeadCell>
                <TableHeadCell className='text-right'>Actions</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {files.map((file) => (
                <FileTableRow
                  key={file.headCid}
                  file={file}
                  user={user!}
                  selectedFiles={selectedFiles}
                  toggleSelectFile={toggleSelectFile}
                  actionButtons={actionButtons}
                  onDownloadFile={setDownloadingCID}
                  onShareFile={setShareCID}
                  onDeleteFile={setDeleteCID}
                  onRestoreFile={setRestoreCID}
                />
              ))}
            </TableBody>
            <TableFooter>
              <tr className='w-full'>
                <td colSpan={5}>
                  <TablePaginator
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    totalItems={totalItems}
                  />
                </td>
              </tr>
            </TableFooter>
          </Table>
        </div>
      </div>
    </div>
  );
};

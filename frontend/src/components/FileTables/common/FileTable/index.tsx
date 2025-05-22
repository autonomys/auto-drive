'use client';

import { Checkbox, Transition } from '@headlessui/react';
import { LoaderCircle, Square, SquareCheck } from 'lucide-react';
import { FC, useCallback, useState } from 'react';
import { ObjectShareModal } from '@/components/FileTables/common/ObjectShareModal';
import { ObjectDeleteModal } from '@/components/FileTables/common/ObjectDeleteModal';
import { ObjectDownloadModal } from '@/components/FileTables/common/ObjectDownloadModal';
import { useUserStore } from 'globalStates/user';
import { Table } from 'components/common/Table';
import {
  TableHead,
  TableHeadCell,
  TableHeadRow,
} from 'components/common/Table/TableHead';
import {
  TableBody,
  TableBodyRow,
  TableBodyCell,
} from 'components/common/Table/TableBody';
import { Button } from 'components/common/Button';
import { TableFooter } from 'components/common/Table/TableFooter';
import { TablePaginator } from './TablePaginator';
import { ObjectRestoreModal } from '../ObjectRestoreModal';
import { FileTableRow } from './FileTableRow';
import { useFileTableState } from '@/components/FileTables/state';
import { SortableTableColumn } from './SortableTableColumn';

export enum FileActionButtons {
  DOWNLOAD = 'download',
  SHARE = 'share',
  DELETE = 'delete',
  RESTORE = 'restore',
  ASYNC_DOWNLOAD = 'asyncDownload',
}

export const FileTable: FC<{
  actionButtons: FileActionButtons[];
  noFilesPlaceholder?: React.ReactNode;
}> = ({ actionButtons, noFilesPlaceholder }) => {
  const user = useUserStore(({ user }) => user);
  const [downloadingCID, setDownloadingCID] = useState<string | null>(null);
  const [shareCID, setShareCID] = useState<string | null>(null);
  const [restoreCID, setRestoreCID] = useState<string | null>(null);
  const [deleteCID, setDeleteCID] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  const objects = useFileTableState((v) => v.objects);
  const refetch = useFileTableState((v) => v.fetch);

  const onClose = useCallback(() => {
    setShareCID(null);
    setDeleteCID(null);
    setDownloadingCID(null);
    setRestoreCID(null);
    setTimeout(() => {
      refetch();
    }, 500);
  }, [refetch]);

  const toggleSelectFile = useCallback((cid: string) => {
    setSelectedFiles((prev) =>
      prev.some((f) => f === cid)
        ? prev.filter((f) => f !== cid)
        : [...prev, cid],
    );
  }, []);

  if (objects && objects.length === 0 && noFilesPlaceholder) {
    return noFilesPlaceholder;
  }

  return (
    <div className='flex flex-col'>
      <ObjectShareModal cid={shareCID} closeModal={() => setShareCID(null)} />
      <ObjectDeleteModal cid={deleteCID} closeModal={onClose} />
      <ObjectDownloadModal cid={downloadingCID} onClose={onClose} />
      <ObjectRestoreModal cid={restoreCID} closeModal={onClose} />
      <div className='-my-2 sm:-mx-6 lg:-mx-8'>
        <div className='inline-block w-full overflow-x-scroll py-2 sm:px-6 lg:px-8'>
          <div className='mb-4 ml-2 flex items-center justify-start gap-2'>
            <div className='flex h-8 items-center'>
              <Checkbox
                className='transition-all duration-200 hover:scale-105 hover:cursor-pointer'
                checked={selectedFiles.length > 0}
                onChange={() =>
                  selectedFiles.length > 0
                    ? setSelectedFiles([])
                    : setSelectedFiles(
                        objects ? objects.map((f) => f.headCid) : [],
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
          <Table className='min-w-full rounded-lg'>
            <TableHead>
              <TableHeadRow>
                <SortableTableColumn name='Name' sortingKey='name' />
                <TableHeadCell>CID</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Size</TableHeadCell>
                <SortableTableColumn name='Date' sortingKey='created_at' />
                <TableHeadCell className='text-right'>Actions</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {objects ? (
                objects.map((file) => (
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
                ))
              ) : (
                <TableBodyRow>
                  <TableBodyCell colSpan={6}>
                    <div className='flex h-10 w-full items-center justify-center'>
                      <LoaderCircle className='h-4 w-4 animate-spin' />
                    </div>
                  </TableBodyCell>
                </TableBodyRow>
              )}
            </TableBody>
            <TableFooter>
              <TableBodyRow className='hover:bg-transparent'>
                <TableBodyCell colSpan={6} className='p-0'>
                  <TablePaginator />
                </TableBodyCell>
              </TableBodyRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    </div>
  );
};

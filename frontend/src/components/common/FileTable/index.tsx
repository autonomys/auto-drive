'use client';

import { ObjectSummary, OwnerRole } from '@/models/UploadedObjectMetadata';
import {
  Checkbox,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Square, SquareCheck } from 'lucide-react';
import {
  ChangeEvent,
  FC,
  Fragment,
  MouseEvent,
  useCallback,
  useRef,
  useState,
} from 'react';
import { Metadata } from '../../Files/Metadata';
import { ObjectShareModal } from '../../Files/ObjectShareModal';
import bytes from 'bytes';
import { ObjectDeleteModal } from '../../Files/ObjectDeleteModal';
import { getTypeFromMetadata } from '../../../utils/file';
import { ObjectDownloadModal } from '../../Files/ObjectDownloadModal';
import { shortenString } from '../../../utils/misc';
import { useUserStore } from '../../../states/user';
import { Table } from '../Table';
import { TableHead, TableHeadCell, TableHeadRow } from '../Table/TableHead';
import { TableBody, TableBodyCell, TableBodyRow } from '../Table/TableBody';
import { DisplayerIcon } from '../Triangle';
import { Button } from '../Button';
import { TableFooter } from '../Table/TableFooter';
import { TablePaginator } from '../TablePaginator';
import { ConditionalRender } from '../ConditionalRender';
import { ObjectRestoreModal } from '../../Files/ObjectRestoreModal';

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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [shareCID, setShareCID] = useState<string | null>(null);
  const [restoreCID, setRestoreCID] = useState<string | null>(null);
  const [deleteCID, setDeleteCID] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<
    {
      type: 'file' | 'folder';
      cid: string;
      name?: string;
      totalSize: number;
    }[]
  >([]);

  const toggleRow = useCallback(
    (id: string) => {
      const newExpandedRows = new Set(expandedRows);
      if (newExpandedRows.has(id)) {
        newExpandedRows.delete(id);
      } else {
        newExpandedRows.add(id);
      }
      setExpandedRows(newExpandedRows);
    },
    [expandedRows],
  );

  const renderOwnerBadge = useCallback(
    (owner: string) => {
      if (owner === user?.publicId) {
        return (
          <span className='rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800'>
            You
          </span>
        );
      } else if (owner.startsWith('@')) {
        return (
          <span className='rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800'>
            {shortenString(owner.slice(1), 15)}
          </span>
        );
      } else {
        return (
          <span className='rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800'>
            {shortenString(owner.slice(1), 15)}
          </span>
        );
      }
    },
    [user?.publicId],
  );

  const downloadFile = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setDownloadingCID(cid);
    },
    [],
  );

  const onDeleteFile = useCallback(
    (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setDeleteCID(cid);
    },
    [],
  );

  const shareFile = useCallback(
    (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setShareCID(cid);
    },
    [],
  );

  const navigateToFile = useCallback((cid: string) => {
    window.location.assign(`/drive/fs/${cid}`);
  }, []);

  const toggleSelectFile = useCallback(
    (
      event: ChangeEvent<HTMLInputElement>,
      entry: {
        type: 'file' | 'folder';
        cid: string;
        name?: string;
        totalSize: number;
      },
    ) => {
      event.stopPropagation();
      if (selectedFiles.some((f) => f.cid === entry.cid)) {
        setSelectedFiles(selectedFiles.filter((f) => f.cid !== entry.cid));
      } else {
        setSelectedFiles([...selectedFiles, entry]);
      }
    },
    [selectedFiles],
  );

  const openRestoreModal = useCallback(
    (event: MouseEvent<HTMLButtonElement>, cid: string) => {
      event.stopPropagation();
      setRestoreCID(cid);
    },
    [],
  );

  const renderRow = useCallback(
    (file: ObjectSummary) => {
      const isExpanded = expandedRows.has(file.headCid);
      const owner = file.owners.find(
        (o) => o.role === OwnerRole.ADMIN,
      )?.publicId;
      const popoverButtonRef = useRef<HTMLButtonElement>(null);
      const isOwner = user?.publicId === owner;
      const [showDownloadTooltip, setShowDownloadTooltip] = useState(false);
      const hasFileOwnership = file.owners.find(
        (e) => e.publicId === user?.publicId,
      );

      return (
        <Fragment key={file.headCid}>
          <TableBodyRow
            className={file.type === 'folder' ? 'hover:cursor-pointer' : ''}
            onClick={() =>
              file.type === 'folder' && navigateToFile(file.headCid)
            }
          >
            <TableBodyCell className='whitespace-nowrap text-sm text-gray-500'>
              <div className='flex items-center'>
                <input
                  type='checkbox'
                  checked={selectedFiles.some((f) => f.cid === file.headCid)}
                  onChange={(e) =>
                    toggleSelectFile(e, {
                      totalSize: file.size,
                      type: file.type,
                      cid: file.headCid,
                      name: file.name,
                    })
                  }
                  className='mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                />
                {file.type === 'folder' && file.children && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(file.headCid);
                    }}
                  >
                    {isExpanded ? (
                      <DisplayerIcon className='rotate-90 text-accent' />
                    ) : (
                      <DisplayerIcon className='text-black' />
                    )}
                  </button>
                )}
                <span
                  className={`relative ml-2 text-sm font-medium text-gray-900 ${
                    file.type === 'folder'
                      ? 'hover:cursor-pointer hover:underline'
                      : ''
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Popover
                    onMouseEnter={() => popoverButtonRef.current?.click()}
                    onMouseLeave={() => popoverButtonRef.current?.click()}
                  >
                    <PopoverButton ref={popoverButtonRef} as='span'>
                      <span className='font-semibold text-accent hover:cursor-pointer'>
                        {file.name
                          ? shortenString(file.name, 30)
                          : `No name (${file.headCid.slice(0, 12)})`}
                      </span>
                    </PopoverButton>
                    <Transition
                      as={Fragment}
                      enter='transition ease-out delay-250'
                      enterFrom='opacity-0 translate-y-1'
                      enterTo='opacity-100 translate-y-0'
                      leave='transition ease-in duration-300'
                      leaveFrom='opacity-100 translate-y-0'
                      leaveTo='opacity-0 translate-y-1'
                    >
                      <PopoverPanel className='absolute left-0 z-10'>
                        <div className='rounded-lg bg-white shadow-md'>
                          <Metadata object={file} />
                        </div>
                      </PopoverPanel>
                    </Transition>
                  </Popover>
                </span>
              </div>
            </TableBodyCell>
            <TableBodyCell>{getTypeFromMetadata(file)}</TableBodyCell>
            <TableBodyCell>{bytes(file.size)}</TableBodyCell>
            <TableBodyCell>
              {owner ? renderOwnerBadge(owner) : 'Unknown'}
            </TableBodyCell>
            <TableBodyCell className='flex justify-end'>
              <ConditionalRender
                condition={actionButtons.includes(FileActionButtons.DOWNLOAD)}
              >
                <div
                  className='relative'
                  onMouseEnter={() => setShowDownloadTooltip(true)}
                  onMouseLeave={() => setShowDownloadTooltip(false)}
                >
                  <Button
                    variant='lightAccent'
                    className='mr-2 text-xs outline-none focus:ring-0'
                    disabled={file.uploadStatus.totalNodes === null}
                    onClick={(e) => downloadFile(e, file.headCid)}
                  >
                    Download
                  </Button>
                  <Transition
                    show={showDownloadTooltip}
                    as={Fragment}
                    enter='transition ease-out delay-250'
                    enterFrom='opacity-0 translate-y-1'
                    enterTo='opacity-100 translate-y-0'
                    leave='transition ease-in duration-300'
                    leaveFrom='opacity-100 translate-y-0'
                    leaveTo='opacity-0 translate-y-1'
                  >
                    <div className='absolute bottom-0 left-0 z-10 translate-y-full'>
                      {file.uploadStatus.totalNodes === null && (
                        <div className='rounded-lg bg-white p-2 shadow-md'>
                          <span className='text-sm text-gray-700'>
                            Processing upload...
                          </span>
                        </div>
                      )}
                    </div>
                  </Transition>
                </div>
              </ConditionalRender>
              <ConditionalRender
                condition={actionButtons.includes(FileActionButtons.SHARE)}
              >
                <Button
                  variant='lightAccent'
                  className='mr-2 text-xs disabled:hidden'
                  disabled={!isOwner}
                  onClick={(e) => shareFile(e, file.headCid)}
                >
                  Share
                </Button>
              </ConditionalRender>
              <ConditionalRender
                condition={actionButtons.includes(FileActionButtons.DELETE)}
              >
                <Button
                  variant='lightDanger'
                  className='text-xs disabled:hidden'
                  disabled={!hasFileOwnership}
                  onClick={(e) => onDeleteFile(e, file.headCid)}
                >
                  Remove
                </Button>
              </ConditionalRender>
              <ConditionalRender
                condition={actionButtons.includes(FileActionButtons.RESTORE)}
              >
                <Button
                  variant='lightAccent'
                  className='text-xs disabled:hidden'
                  onClick={(e) => openRestoreModal(e, file.headCid)}
                >
                  Restore
                </Button>
              </ConditionalRender>
            </TableBodyCell>
          </TableBodyRow>
          {isExpanded &&
            file.type === 'folder' &&
            file.children &&
            file.children.map((child) => (
              <TableBodyRow key={child.cid}>
                <TableBodyCell className='w-[50%]'>
                  <div className='flex items-center'>
                    <input
                      onChange={(e) => toggleSelectFile(e, child)}
                      checked={selectedFiles.some((f) => f.cid === child.cid)}
                      type='checkbox'
                      className='mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                    />
                    -
                    <span
                      className={`relative ml-2 text-sm font-semibold text-accent ${
                        file.type === 'folder'
                          ? 'hover:cursor-pointer hover:underline'
                          : ''
                      }`}
                    >
                      {child.name ?? `No name (${child.cid.slice(0, 12)})`}
                    </span>
                  </div>
                </TableBodyCell>
                <TableBodyCell>
                  <span>{child.type === 'file' ? 'File' : 'Folder'}</span>
                </TableBodyCell>
                <TableBodyCell>
                  <span>{bytes(child.totalSize)}</span>
                </TableBodyCell>
                <TableBodyCell>
                  {owner ? renderOwnerBadge(owner) : 'Unknown'}
                </TableBodyCell>
                <TableBodyCell>
                  <Button
                    variant='lightAccent'
                    className='text-xs'
                    onClick={(e) => downloadFile(e, child.cid)}
                  >
                    Download
                  </Button>
                </TableBodyCell>
              </TableBodyRow>
            ))}
        </Fragment>
      );
    },
    [
      expandedRows,
      navigateToFile,
      downloadFile,
      renderOwnerBadge,
      toggleRow,
      toggleSelectFile,
      selectedFiles,
      user?.publicId,
      actionButtons,
      onDeleteFile,
      shareFile,
      openRestoreModal,
    ],
  );

  const onClose = useCallback(() => {
    setShareCID(null);
    setDeleteCID(null);
    setDownloadingCID(null);
    setRestoreCID(null);
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
                        files.map((f) => ({
                          type: f.type,
                          cid: f.headCid,
                          name: f.name,
                          totalSize: f.size,
                        })),
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
            <TableBody>{files.map((file) => renderRow(file))}</TableBody>
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

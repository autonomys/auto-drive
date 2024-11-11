import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import {
  ObjectSummary,
  OwnerRole,
} from '../../../models/UploadedObjectMetadata';
import { User } from '../../../models/User';
import { TableBodyCell, TableBodyRow } from '../Table/TableBody';
import { DisplayerIcon } from '../Triangle';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { shortenString } from '../../../utils/misc';
import { Metadata } from '../../Files/Metadata';
import { getTypeFromMetadata } from '../../../utils/file';
import { ConditionalRender } from '../ConditionalRender';
import { FileActionButtons } from '../FileTable';
import bytes from 'bytes';
import { Button } from '../Button';
import { handleEnterOrSpace } from '../../../utils/eventHandler';

export const FileTableRow = ({
  file,
  user,
  selectedFiles,
  toggleSelectFile,
  actionButtons,
  onDownloadFile,
  onShareFile,
  onDeleteFile,
  onRestoreFile,
}: {
  file: ObjectSummary;
  user: User;
  selectedFiles: string[];
  toggleSelectFile: (cid: string) => void;
  actionButtons: FileActionButtons[];
  onDownloadFile: (cid: string) => void;
  onShareFile: (cid: string) => void;
  onDeleteFile: (cid: string) => void;
  onRestoreFile: (cid: string) => void;
}) => {
  const [isRowExpanded, setIsRowExpanded] = useState(false);

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

  const owner = file.owners.find((o) => o.role === OwnerRole.ADMIN)?.publicId;

  const popoverButtonRef = useRef<HTMLButtonElement>(null);
  const isOwner = user?.publicId === owner;
  const [showDownloadTooltip, setShowDownloadTooltip] = useState(false);
  const hasFileOwnership = file.owners.find(
    (e) => e.publicId === user?.publicId,
  );

  const stopEventPropagation = useCallback(function <
    E extends
      | React.MouseEvent<HTMLButtonElement | HTMLInputElement>
      | React.KeyboardEvent<HTMLButtonElement>,
  >(callback: () => void) {
    return (e: E) => {
      e.preventDefault();
      if (e instanceof MouseEvent) {
        e.stopImmediatePropagation();
      } else {
        e.stopPropagation();
      }
      callback();
    };
  }, []);

  const handleShare = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() =>
        onShareFile(file.headCid),
      ),
    [onShareFile, file.headCid, stopEventPropagation],
  );
  const handleDelete = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() =>
        onDeleteFile(file.headCid),
      ),
    [onDeleteFile, file.headCid, stopEventPropagation],
  );
  const handleRestore = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() =>
        onRestoreFile(file.headCid),
      ),
    [onRestoreFile, file.headCid, stopEventPropagation],
  );
  const handleToggleSelectFile = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLInputElement>>(() =>
        toggleSelectFile(file.headCid),
      ),
    [toggleSelectFile, file.headCid, stopEventPropagation],
  );

  const toggleExpand = useCallback(() => setIsRowExpanded((prev) => !prev), []);

  const toggleExpandClickHandler = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(toggleExpand),
    [toggleExpand, stopEventPropagation],
  );

  return (
    <Fragment key={file.headCid}>
      <TableBodyRow
        className={file.type === 'folder' ? 'hover:cursor-pointer' : ''}
      >
        <TableBodyCell className='whitespace-nowrap text-sm text-gray-500'>
          <div className='flex items-center'>
            <input
              type='checkbox'
              readOnly={true}
              checked={selectedFiles.some((cid) => cid === file.headCid)}
              onClick={handleToggleSelectFile}
              className='mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
            />
            {file.type === 'folder' && file.children && (
              <button onClick={toggleExpandClickHandler}>
                {isRowExpanded ? (
                  <DisplayerIcon className='rotate-90 text-accent' />
                ) : (
                  <DisplayerIcon className='text-black' />
                )}
              </button>
            )}
            <span
              role='button'
              tabIndex={0}
              onKeyDown={handleEnterOrSpace(toggleExpand)}
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
                onClick={() => onDownloadFile(file.headCid)}
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
              onClick={handleShare}
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
              onClick={handleDelete}
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
              onClick={handleRestore}
            >
              Restore
            </Button>
          </ConditionalRender>
        </TableBodyCell>
      </TableBodyRow>
      {isRowExpanded &&
        file.type === 'folder' &&
        file.children &&
        file.children.map((child) => (
          <TableBodyRow key={child.cid}>
            <TableBodyCell className='w-[50%]'>
              <div className='flex items-center'>
                <input
                  onClick={stopEventPropagation(() =>
                    toggleSelectFile(child.cid),
                  )}
                  readOnly={true}
                  checked={selectedFiles.some((f) => f === child.cid)}
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
                onClick={() => onDownloadFile(child.cid)}
              >
                Download
              </Button>
            </TableBodyCell>
          </TableBodyRow>
        ))}
    </Fragment>
  );
};

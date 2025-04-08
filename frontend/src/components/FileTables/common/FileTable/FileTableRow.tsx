import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { ObjectSummary, OwnerRole, User } from '@auto-drive/models';
import { TableBodyCell, TableBodyRow } from 'components/common/Table/TableBody';
import { DisplayerIcon } from 'components/common/Triangle';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { shortenString } from 'utils/misc';
import { Metadata } from '@/components/FileTables/common/Metadata';
import { getTypeFromMetadata } from 'utils/file';
import { ConditionalRender } from 'components/common/ConditionalRender';
import { FileActionButtons } from '@/components/FileTables/common/FileTable';
import bytes from 'bytes';
import { Button } from 'components/common/Button';
import { handleEnterOrSpace } from 'utils/eventHandler';
import { SquareArrowOutUpRight } from 'lucide-react';
import { InternalLink } from 'components/common/InternalLink';
import { OwnerBadge } from './OwnerBadge';
import { useNetwork } from 'contexts/network';
import { ROUTES } from 'constants/routes';
import { utcToLocalRelativeTime } from 'utils/time';

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
  const { network } = useNetwork();

  const owner = file.owners.find((o) => o.role === OwnerRole.ADMIN);

  const popoverButtonRef = useRef<HTMLButtonElement>(null);
  const isOwner =
    user?.oauthProvider === owner?.oauthProvider &&
    user?.oauthUserId === owner?.oauthUserId;

  const [showDownloadTooltip, setShowDownloadTooltip] = useState(false);

  const hasFileOwnership = file.owners.find(
    (e) =>
      e.oauthProvider === user?.oauthProvider &&
      e.oauthUserId === user?.oauthUserId,
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
    () => (headCid: string) => {
      toggleSelectFile(headCid);
    },
    [toggleSelectFile],
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
              onChange={() => handleToggleSelectFile(file.headCid)}
              className='mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
            />
            {file.type === 'folder' && file.children && (
              <button onClick={toggleExpandClickHandler}>
                {isRowExpanded ? (
                  <DisplayerIcon className='rotate-90 text-accent' />
                ) : (
                  <DisplayerIcon className='text-black dark:text-darkBlack' />
                )}
              </button>
            )}
            <span
              role='button'
              tabIndex={0}
              onKeyDown={handleEnterOrSpace(toggleExpand)}
              className={`relative ml-2 text-sm font-medium text-gray-900 dark:text-darkBlack ${
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
                <PopoverButton
                  ref={popoverButtonRef}
                  as='div'
                  className='flex items-center'
                >
                  <span className='font-semibold text-accent hover:cursor-pointer'>
                    {file.name
                      ? shortenString(file.name, 30)
                      : `No name (${file.headCid.slice(0, 12)})`}
                  </span>
                  <ConditionalRender condition={file.tags.includes('insecure')}>
                    <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
                      Insecure
                    </span>
                  </ConditionalRender>
                  <InternalLink
                    href={ROUTES.objectDetails(network.id, file.headCid)}
                  >
                    <SquareArrowOutUpRight className='ml-2 h-4 w-4 transition-all duration-200 hover:scale-105' />
                  </InternalLink>
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
                    <div className='rounded-lg bg-white shadow-md dark:bg-darkWhite'>
                      <Metadata object={file} />
                    </div>
                  </PopoverPanel>
                </Transition>
              </Popover>
            </span>
          </div>
        </TableBodyCell>
        <TableBodyCell>{getTypeFromMetadata(file)}</TableBodyCell>
        <TableBodyCell>{bytes(Number(file.size))}</TableBodyCell>
        <TableBodyCell>
          {file.createdAt ? utcToLocalRelativeTime(file.createdAt) : 'Unknown'}
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
                disabled={file.uploadState.totalNodes === null}
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
                  {file.uploadState.totalNodes === null && (
                    <div className='rounded-lg bg-white p-2 shadow-md dark:bg-darkWhite'>
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
                  onChange={() => toggleSelectFile(child.cid)}
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
                <InternalLink
                  href={ROUTES.objectDetails(network.id, child.cid)}
                >
                  <SquareArrowOutUpRight className='ml-2 h-4 w-4 transition-all duration-200 hover:scale-105' />
                </InternalLink>
              </div>
            </TableBodyCell>
            <TableBodyCell>
              <span>{child.type === 'file' ? 'File' : 'Folder'}</span>
            </TableBodyCell>
            <TableBodyCell>
              <span>{bytes(Number(child.totalSize))}</span>
            </TableBodyCell>
            <TableBodyCell>
              <OwnerBadge />
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

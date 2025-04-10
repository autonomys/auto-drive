import { Fragment, useCallback, useMemo, useState } from 'react';
import { ObjectSummary, OwnerRole, User } from '@auto-drive/models';
import { TableBodyCell, TableBodyRow } from 'components/common/Table/TableBody';
import { DisplayerIcon } from 'components/common/Triangle';
import { Transition } from '@headlessui/react';
import { shortenString } from 'utils/misc';
import { ConditionalRender } from 'components/common/ConditionalRender';
import { FileActionButtons } from '@/components/FileTables/common/FileTable';
import bytes from 'bytes';
import { Button } from 'components/common/Button';
import { handleEnterOrSpace } from 'utils/eventHandler';
import { SquareArrowOutUpRight, Copy, Check, File, Folder } from 'lucide-react';
import { InternalLink } from 'components/common/InternalLink';
import { OwnerBadge } from './OwnerBadge';
import { useNetwork } from 'contexts/network';
import { ROUTES } from 'constants/routes';
import { utcToLocalRelativeTime, formatDate } from 'utils/time';
import { Badge } from 'components/common/Badge';
import { DocumentIcon } from '@heroicons/react/24/outline';
import { formatCid } from '@/utils/table';
import { cn } from '@/utils/cn';

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
  const { network } = useNetwork();

  const [isRowExpanded, setIsRowExpanded] = useState(false);
  const [showDownloadTooltip, setShowDownloadTooltip] = useState(false);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);

  const owner = file.owners.find((o) => o.role === OwnerRole.ADMIN);
  const isOwner =
    user?.oauthProvider === owner?.oauthProvider &&
    user?.oauthUserId === owner?.oauthUserId;
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

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCid(text);
    // Reset the icon after 2 seconds
    setTimeout(() => {
      setCopiedCid(null);
    }, 2000);
  }, []);

  return (
    <Fragment key={file.headCid}>
      <TableBodyRow
        className={cn(
          file.type === 'folder' ? 'hover:cursor-pointer' : '',
          selectedFiles.includes(file.headCid) &&
            'bg-gray-100 hover:bg-gray-100',
        )}
      >
        <TableBodyCell className='whitespace-nowrap text-sm'>
          <div className='flex items-center'>
            <input
              type='checkbox'
              readOnly={true}
              checked={selectedFiles.some((cid) => cid === file.headCid)}
              onChange={() => handleToggleSelectFile(file.headCid)}
              className='mr-3 h-4 w-4 rounded text-blue-600 focus:ring-blue-500'
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
              className={`relative ml-2 flex flex-row items-center text-sm font-medium text-gray-900 dark:text-darkBlack ${
                file.type === 'folder'
                  ? 'hover:cursor-pointer hover:underline'
                  : ''
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <InternalLink
                href={ROUTES.objectDetails(network.id, file.headCid)}
              >
                {file.type === 'folder' ? (
                  <Folder className='mr-2 h-5 w-5 text-gray-400' />
                ) : (
                  <DocumentIcon className='mr-2 h-5 w-5 text-gray-400' />
                )}
                <span className='font-semibold text-gray-900 hover:cursor-pointer hover:text-accent hover:underline dark:text-accent'>
                  {file.name
                    ? shortenString(file.name, 30)
                    : `No name (${file.headCid.slice(0, 12)})`}
                </span>
              </InternalLink>
              <ConditionalRender condition={file.tags.includes('insecure')}>
                <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
                  Insecure
                </span>
              </ConditionalRender>
            </span>
          </div>
        </TableBodyCell>
        <TableBodyCell>
          <div className='group relative flex cursor-pointer items-center gap-2'>
            <span role='button' tabIndex={0}>
              {formatCid(file.headCid)}
            </span>
            <div className='relative'>
              {copiedCid === file.headCid ? (
                <Check className='h-4 w-4 text-green-500' />
              ) : (
                <Copy
                  className='h-4 w-4 text-gray-400 hover:text-gray-700 dark:text-darkBlack dark:hover:text-gray-100'
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(file.headCid);
                  }}
                />
              )}
              <div className='pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100'>
                {copiedCid === file.headCid ? 'Copied!' : 'Copy CID'}
              </div>
            </div>
          </div>
        </TableBodyCell>
        <TableBodyCell>
          <Badge label={file.status} status={file.status} />
        </TableBodyCell>
        <TableBodyCell>{bytes(Number(file.size))}</TableBodyCell>
        <TableBodyCell>
          <div className='group relative'>
            <span className='cursor-default'>
              {file.createdAt ? formatDate(file.createdAt) : 'Unknown'}
            </span>
            {file.createdAt && (
              <div className='pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100'>
                {utcToLocalRelativeTime(file.createdAt)}
              </div>
            )}
          </div>
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
                  className='mr-3 rounded text-blue-600 focus:ring-blue-500'
                />
                {child.type === 'folder' ? (
                  <Folder className='mx-2 h-5 w-5 flex-shrink-0 text-blue-500' />
                ) : (
                  <File className='mx-2 h-5 w-5 flex-shrink-0 text-accent' />
                )}
                <span
                  className={`relative text-sm font-semibold text-accent ${
                    file.type === 'folder'
                      ? 'hover:cursor-pointer hover:underline'
                      : ''
                  }`}
                >
                  {child.name ?? `No name (${formatCid(child.cid)})`}
                </span>
                <InternalLink
                  href={ROUTES.objectDetails(network.id, child.cid)}
                >
                  <SquareArrowOutUpRight className='ml-2 h-4 w-4 transition-all duration-200 hover:scale-105' />
                </InternalLink>
                <div className='group relative ml-2 flex cursor-pointer items-center'>
                  <span
                    className='mr-1 text-xs text-gray-500 hover:text-accent'
                    role='button'
                    tabIndex={0}
                  >
                    {formatCid(child.cid)}
                  </span>
                  <div className='relative'>
                    {copiedCid === child.cid ? (
                      <Check className='h-4 w-4 text-green-500' />
                    ) : (
                      <Copy
                        className='h-4 w-4 text-gray-400 group-hover:text-accent'
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(child.cid);
                        }}
                      />
                    )}
                    <div className='pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100'>
                      {copiedCid === child.cid ? 'Copied!' : 'Copy CID'}
                    </div>
                  </div>
                </div>
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

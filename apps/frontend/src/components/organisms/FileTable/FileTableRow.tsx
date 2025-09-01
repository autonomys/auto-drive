import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
} from 'react';
import {
  isBanned,
  isInsecure,
  isToBeReviewed,
  ObjectSummary,
  ObjectTag,
  OwnerRole,
  User,
} from '@auto-drive/models';
import {
  TableBodyCell,
  TableBodyRow,
} from '@/components/molecules/Table/TableBody';
import { Triangle } from '@/components/atoms/Triangle';
import { shortenString } from 'utils/misc';
import { ConditionalRender } from '@/components/atoms/ConditionalRender';
import { FileActionButtons } from '@/components/organisms/FileTable';
import bytes from 'bytes';
import { Button } from '@auto-drive/ui';
import { File, Folder, MoreVertical } from 'lucide-react';
import { OwnerBadge } from './OwnerBadge';
import { useNetwork } from 'contexts/network';
import { utcToLocalRelativeTime, formatLocalDate } from 'utils/time';
import { Badge } from '@/components/atoms/Badge';
import { DocumentIcon } from '@heroicons/react/24/outline';
import { formatCid } from '@/utils/table';
import { cn } from '@/utils/cn';
import Link from 'next/link';
import dayjs from 'dayjs';
import { CopiableText } from '@/components/atoms/CopiableText';
import toast from 'react-hot-toast';
import { useUserAsyncDownloadsStore } from '../UserAsyncDownloads/state';
import { useFileInCache } from '@/hooks/useFileInCache';
import { NetworkId } from '@/constants/networks';

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
  onReportFile,
  fileDetailPath,
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
  onReportFile: (cid: string) => void;
  fileDetailPath: (networkId: NetworkId, cid: string) => string;
}) => {
  const { network } = useNetwork();

  const [isRowExpanded, setIsRowExpanded] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const updateAsyncDownloads = useUserAsyncDownloadsStore((e) => e.update);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const isCached = useFileInCache(file.headCid);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showActionsMenu &&
        actionsMenuRef.current &&
        buttonRef.current &&
        !actionsMenuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowActionsMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActionsMenu]);

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
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() => {
        setShowActionsMenu(false);
        onShareFile(file.headCid);
      }),
    [onShareFile, file.headCid, stopEventPropagation],
  );

  const handleDelete = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() => {
        setShowActionsMenu(false);
        onDeleteFile(file.headCid);
      }),
    [onDeleteFile, file.headCid, stopEventPropagation],
  );

  const handleRestore = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() => {
        setShowActionsMenu(false);
        onRestoreFile(file.headCid);
      }),
    [onRestoreFile, file.headCid, stopEventPropagation],
  );

  const handleReport = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() => {
        setShowActionsMenu(false);
        onReportFile(file.headCid);
      }),
    [onReportFile, file.headCid, stopEventPropagation],
  );

  const handleToggleSelectFile = useMemo(
    () => (headCid: string) => {
      toggleSelectFile(headCid);
    },
    [toggleSelectFile],
  );

  const toggleExpand = useCallback(() => setIsRowExpanded((prev) => !prev), []);

  const { api } = useNetwork();

  const toggleExpandClickHandler = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(toggleExpand),
    [toggleExpand, stopEventPropagation],
  );

  const handleAsyncDownload = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() => {
        setShowActionsMenu(false);
        const toastId = toast.loading('Requesting async download...');
        api
          .createAsyncDownload(file.headCid)
          .then(() => {
            toast.success('Async download requested', { id: toastId });
            updateAsyncDownloads();
          })
          .catch(() => {
            toast.error('Failed to request async download', { id: toastId });
          });
      }),
    [api, file.headCid, stopEventPropagation, updateAsyncDownloads],
  );

  const handleDownload = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() => {
        setShowActionsMenu(false);
        onDownloadFile(file.headCid);
      }),
    [onDownloadFile, file.headCid, stopEventPropagation],
  );

  const toggleActionsMenu = useMemo(
    () =>
      stopEventPropagation<React.MouseEvent<HTMLButtonElement>>(() => {
        setShowActionsMenu((prev) => !prev);
      }),
    [stopEventPropagation],
  );

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
                  <Triangle className='rotate-90 text-accent' />
                ) : (
                  <Triangle className='dark:text-darkBlack text-black' />
                )}
              </button>
            )}
            <Link
              href={fileDetailPath(network.id, file.headCid)}
              className='dark:text-darkBlack relative ml-2 flex flex-row items-center text-sm font-medium text-gray-900'
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
            </Link>
            <ConditionalRender condition={isInsecure(file.tags)}>
              <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
                Insecure
              </span>
            </ConditionalRender>
            {isToBeReviewed(file.tags) && !isBanned(file.tags) && (
              <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
                Reported
              </span>
            )}
            {isBanned(file.tags) && (
              <span className='ml-2 rounded-lg bg-red-500 p-1 text-xs font-semibold text-white'>
                Banned
              </span>
            )}
          </div>
        </TableBodyCell>
        <TableBodyCell>
          <CopiableText
            text={file.headCid}
            displayText={formatCid(file.headCid)}
          />
        </TableBodyCell>
        <TableBodyCell>
          <Badge label={file.status} status={file.status} />
        </TableBodyCell>
        <TableBodyCell>{bytes(Number(file.size))}</TableBodyCell>
        <TableBodyCell>
          <div className='group relative'>
            <span className='flex cursor-default items-center'>
              {file.createdAt ? formatLocalDate(file.createdAt) : 'Unknown'}
            </span>
            {file.createdAt && (
              <div className='pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-gray-700'>
                {utcToLocalRelativeTime(file.createdAt)}
                <div className='mt-0.5 text-xs opacity-75'>
                  {dayjs.utc(file.createdAt).format('YYYY-MM-DD HH:mm:ss')} UTC
                </div>
              </div>
            )}
          </div>
        </TableBodyCell>
        <TableBodyCell className='flex justify-end'>
          <div className='relative'>
            <div ref={buttonRef}>
              <Button
                variant='outline'
                className='p-1'
                onClick={toggleActionsMenu}
              >
                <MoreVertical className='h-5 w-5' />
              </Button>
            </div>

            {showActionsMenu && (
              <div
                className='dark:bg-darkWhite absolute right-0 top-full z-10 mt-1 w-36 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5'
                ref={actionsMenuRef}
              >
                <div className='py-1' role='menu' aria-orientation='vertical'>
                  {actionButtons.includes(FileActionButtons.SHARE) && (
                    <button
                      className={cn(
                        'block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-200',
                        !isOwner && 'cursor-not-allowed opacity-50',
                      )}
                      disabled={!isOwner}
                      onClick={handleShare}
                      role='menuitem'
                    >
                      Share
                    </button>
                  )}

                  {actionButtons.includes(FileActionButtons.ASYNC_DOWNLOAD) &&
                    !isCached && (
                      <button
                        className={cn(
                          'block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-200',
                          isBanned(file.tags) &&
                            'cursor-not-allowed opacity-50',
                        )}
                        disabled={isBanned(file.tags)}
                        onClick={handleAsyncDownload}
                        role='menuitem'
                      >
                        Bring to Cache
                        {isBanned(file.tags) && (
                          <div className='mt-1 text-xs text-gray-500'>
                            File is banned
                          </div>
                        )}
                      </button>
                    )}

                  {actionButtons.includes(FileActionButtons.DOWNLOAD) && (
                    <button
                      className={cn(
                        'block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-200',
                        (file.uploadState.totalNodes === null ||
                          file.tags.includes(ObjectTag.Banned)) &&
                          'cursor-not-allowed opacity-50',
                      )}
                      disabled={
                        file.uploadState.totalNodes === null ||
                        file.tags.includes(ObjectTag.Banned)
                      }
                      onClick={handleDownload}
                      role='menuitem'
                    >
                      Download
                      {file.uploadState.totalNodes === null && (
                        <div className='mt-1 text-xs text-gray-500'>
                          Processing upload...
                        </div>
                      )}
                      {isBanned(file.tags) && (
                        <div className='mt-1 text-xs text-gray-500'>
                          File is banned
                        </div>
                      )}
                    </button>
                  )}

                  {actionButtons.includes(FileActionButtons.DELETE) && (
                    <button
                      className={cn(
                        'block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-200',
                        !hasFileOwnership && 'cursor-not-allowed opacity-50',
                      )}
                      disabled={!hasFileOwnership}
                      onClick={handleDelete}
                      role='menuitem'
                    >
                      Remove
                    </button>
                  )}

                  {actionButtons.includes(FileActionButtons.RESTORE) && (
                    <button
                      className='block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-200'
                      onClick={handleRestore}
                      role='menuitem'
                    >
                      Restore
                    </button>
                  )}
                  {actionButtons.includes(FileActionButtons.REPORT) &&
                    !isToBeReviewed(file.tags) &&
                    !isBanned(file.tags) && (
                      <button
                        className='block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-200'
                        onClick={handleReport}
                        role='menuitem'
                      >
                        Report
                      </button>
                    )}
                </div>
              </div>
            )}
          </div>
        </TableBodyCell>
      </TableBodyRow>
      {isRowExpanded &&
        file.type === 'folder' &&
        file.children &&
        file.children.map((child) => (
          <TableBodyRow key={child.cid}>
            <TableBodyCell>
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

                <Link href={fileDetailPath(network.id, child.cid)}>
                  <span
                    className={`relative text-sm font-semibold text-accent ${
                      file.type === 'folder'
                        ? 'hover:cursor-pointer hover:underline'
                        : ''
                    }`}
                  >
                    {child.name ?? `No name (${formatCid(child.cid)})`}
                  </span>
                </Link>
              </div>
            </TableBodyCell>
            <TableBodyCell>
              <CopiableText
                text={child.cid}
                displayText={formatCid(child.cid)}
              />
            </TableBodyCell>
            <TableBodyCell>
              <OwnerBadge />
            </TableBodyCell>
            <TableBodyCell>{bytes(Number(child.totalSize))}</TableBodyCell>
            <TableBodyCell>
              {child.type === 'file' ? 'File' : 'Folder'}
            </TableBodyCell>
            <TableBodyCell className='flex justify-end'>
              <Button
                variant='lightAccent'
                className={cn(
                  'text-xs',
                  file.tags.includes(ObjectTag.Banned) &&
                    'cursor-not-allowed opacity-50',
                )}
                disabled={file.tags.includes(ObjectTag.Banned)}
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

import { OwnerRole, ObjectInformation, ObjectTag } from '@auto-drive/models';
import { getTypeFromMetadata } from 'utils/file';
import { useUserStore } from 'globalStates/user';
import { useCallback, useMemo, useState } from 'react';
import { Button } from 'components/common/Button';
import { ObjectShareModal } from '@/components/FileTables/common/ObjectShareModal';
import { ObjectDeleteModal } from '@/components/FileTables/common/ObjectDeleteModal';
import { Loader } from 'lucide-react';
import { ObjectDownloadModal } from '@/components/FileTables/common/ObjectDownloadModal';
import { FilePreview } from '@/components/FilePreview';
import {
  ArrowDownTrayIcon,
  ShareIcon,
  TrashIcon,
  LockClosedIcon,
  LockOpenIcon,
  InformationCircleIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { EXTERNAL_ROUTES } from '@/constants/routes';
import { NetworkId } from '@/constants/networks';
import { useNetwork } from 'contexts/network';
import bytes from 'bytes';
import { formatNumberWithCommas } from '@/utils/number';
import { FileIcons } from './FileIcons';
import { ConditionalRender } from '../common/ConditionalRender';
import { Badge } from 'components/common/Badge';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';

const getBlockExplorerUrl = (
  networkId: NetworkId,
  blockDepth?: number,
): string => {
  if (!blockDepth) return '#';
  return (
    EXTERNAL_ROUTES.astral + `/${networkId}/consensus/blocks/${blockDepth}`
  );
};

const IconWithTooltip = ({
  icon,
  tooltip,
}: {
  icon: React.ReactNode;
  tooltip: string;
}) => {
  return (
    <div className='group relative inline-flex items-center'>
      {icon}
      <div className='invisible absolute bottom-full left-2 z-10 mb-1 -translate-x-1/4 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:visible group-hover:opacity-100'>
        {tooltip}
        <div className='absolute left-1/4 top-full border-4 border-transparent border-t-gray-800'></div>
      </div>
    </div>
  );
};

export const UploadedObjectInformation = ({
  object,
}: {
  object: ObjectInformation | null;
}) => {
  const { network, api } = useNetwork();

  const [downloadModalCid, setDownloadModalCid] = useState<string | null>(null);
  const [shareModalCid, setShareModalCid] = useState<string | null>(null);
  const [deleteModalCid, setDeleteModalCid] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const user = useUserStore(({ user }) => user);

  const owners = useMemo(() => {
    return object?.owners.sort((a, b) => a.role.localeCompare(b.role));
  }, [object?.owners]);

  const isOwner = owners?.some(
    (o) =>
      o.oauthProvider === user?.oauthProvider &&
      o.oauthUserId === user?.oauthUserId &&
      o.role === OwnerRole.ADMIN,
  );
  const hasFileOwnership = object?.owners.some(
    (o) =>
      o.oauthProvider === user?.oauthProvider &&
      o.oauthUserId === user?.oauthUserId,
  );

  const handleDownload = useCallback(async () => {
    if (!object?.metadata.dataCid) {
      return;
    }
    setDownloadModalCid(object.metadata.dataCid);
  }, [object?.metadata.dataCid]);

  const handleShare = useCallback(() => {
    setShareModalCid(object?.metadata.dataCid ?? null);
  }, [object?.metadata.dataCid]);

  const handleDelete = useCallback(() => {
    setDeleteModalCid(object?.metadata.dataCid ?? null);
  }, [object?.metadata.dataCid]);

  const handleReport = useCallback(async () => {
    if (!object?.metadata.dataCid) {
      return;
    }

    setIsReporting(true);
    try {
      await api.reportFile(object.metadata.dataCid);
      toast.success('File has been reported successfully');
    } catch (error) {
      console.error('Report error:', error);
      toast.error('Failed to report file. Please try again.');
    } finally {
      setIsReporting(false);
    }
  }, [api, object?.metadata.dataCid]);

  const isLoading = object === null;
  if (isLoading) {
    return (
      <div className='flex flex-col gap-4'>
        <div className='flex items-center justify-center'>
          <Loader className='h-4 w-4 animate-spin' />
        </div>
      </div>
    );
  }

  return (
    <div className='container mx-auto flex flex-grow flex-col gap-6'>
      <ObjectDownloadModal
        cid={downloadModalCid}
        onClose={() => setDownloadModalCid(null)}
      />
      <ObjectShareModal
        cid={shareModalCid}
        closeModal={() => setShareModalCid(null)}
      />
      <ObjectDeleteModal
        cid={deleteModalCid}
        closeModal={() => setDeleteModalCid(null)}
      />
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-3'>
          <div className='rounded-lg bg-blue-100 p-2 dark:bg-darkPrimary'>
            <FileIcons fileType={getTypeFromMetadata(object.metadata) ?? ''} />
          </div>
          <div>
            <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              {object.metadata.name ?? 'Unnamed'}
            </h1>
            <p className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
              {getTypeFromMetadata(object.metadata)} •{' '}
              {bytes(Number(object.metadata.totalSize))}
              <Badge label={object.status} status={object.status} />
              <ConditionalRender condition={object.tags.includes('insecure')}>
                <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
                  Insecure
                </span>
              </ConditionalRender>
              <ConditionalRender
                condition={
                  object.tags.includes(ObjectTag.ToBeReviewed) &&
                  !object.tags.includes(ObjectTag.Banned)
                }
              >
                <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
                  On review
                </span>
              </ConditionalRender>
              <ConditionalRender
                condition={object.tags.includes(ObjectTag.Banned)}
              >
                <span className='ml-2 rounded-lg bg-red-500 p-1 text-xs font-semibold text-white'>
                  Banned
                </span>
              </ConditionalRender>
            </p>
          </div>
        </div>
        <div className='flex space-x-2'>
          <Button
            variant='lightAccent'
            className={cn(
              'inline-flex items-center text-sm',
              object.tags.includes(ObjectTag.Banned) &&
                'cursor-not-allowed opacity-50',
            )}
            disabled={object.tags.includes(ObjectTag.Banned)}
            onClick={handleDownload}
          >
            <ArrowDownTrayIcon className='mr-2 h-4 w-4' />
            Download
            {object.tags.includes(ObjectTag.Banned) && (
              <span className='ml-2 text-xs text-gray-500'>
                (File is banned)
              </span>
            )}
          </Button>
          <Button
            variant='lightAccent'
            className='inline-flex items-center text-sm disabled:hidden'
            onClick={handleShare}
            disabled={!isOwner}
          >
            <ShareIcon className='mr-2 h-4 w-4' />
            Share
          </Button>
          <Button
            variant='lightDanger'
            className='inline-flex items-center text-sm disabled:hidden'
            onClick={handleDelete}
            disabled={!hasFileOwnership}
          >
            <TrashIcon className='mr-2 h-4 w-4' />
            Remove
          </Button>
          <Button
            variant='lightAccent'
            className='inline-flex items-center bg-orange-100 text-sm text-orange-700 hover:bg-orange-200'
            onClick={handleReport}
            disabled={
              isReporting ||
              object.tags.includes(ObjectTag.ToBeReviewed) ||
              object.tags.includes(ObjectTag.Banned)
            }
          >
            <ExclamationTriangleIcon className='mr-2 h-4 w-4' />
            {isReporting ? 'Reporting...' : 'Report'}
          </Button>
        </div>
      </div>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        <div className='rounded-lg border border-gray-200 p-6 dark:border-gray-200 bg-background'>
          <h2 className='mb-4 flex items-center text-lg font-medium text-gray-900 dark:text-gray-100'>
            <IconWithTooltip
              icon={
                <InformationCircleIcon className='mr-2 h-5 w-5 text-gray-500' />
              }
              tooltip='File metadata and information'
            />
            Metadata
          </h2>
          <div className='space-y-3'>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Name:
              </span>
              <span className='text-sm font-medium'>
                {object.metadata.name ?? 'Unnamed'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Type:
              </span>
              <span className='text-sm font-medium'>
                {getTypeFromMetadata(object.metadata)}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Size:
              </span>
              <span className='text-sm font-medium'>
                {bytes(Number(object.metadata.totalSize))}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Owner:
              </span>
              <span className='text-sm font-medium'>
                {isOwner ? 'You' : 'Unknown'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Uploaded Nodes:
              </span>
              <span className='text-sm font-medium'>
                {object.uploadState.uploadedNodes ?? 'Processing'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Total Nodes:
              </span>
              <span className='text-sm font-medium'>
                {object.uploadState.totalNodes ?? 'Processing'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Block range:
              </span>
              <span className='text-sm font-medium'>
                {object.uploadState.minimumBlockDepth ? (
                  <a
                    href={getBlockExplorerUrl(
                      network.id,
                      object.uploadState.minimumBlockDepth,
                    )}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='hover:text-accent-hover text-accent hover:underline'
                  >
                    {formatNumberWithCommas(
                      object.uploadState.minimumBlockDepth,
                    )}
                  </a>
                ) : (
                  'N/A'
                )}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Archive blocks count:
              </span>
              <span className='text-sm font-medium'>0</span>
            </div>
          </div>
        </div>
        <div className='rounded-lg border border-gray-200 p-6 bg-background'>
          <h2 className='mb-4 flex items-center text-lg font-medium text-gray-900 dark:text-gray-100'>
            <IconWithTooltip
              icon={<CloudArrowUpIcon className='mr-2 h-5 w-5 text-gray-500' />}
              tooltip='Status of file upload to the network'
            />
            Upload Status
          </h2>
          <div className='space-y-3'>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Total Nodes:
              </span>
              <span className='text-sm font-medium'>
                {object.uploadState.totalNodes}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Uploaded Nodes:
              </span>
              <span className='text-sm font-medium'>
                {object.uploadState.uploadedNodes}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Block range:
              </span>
              <span className='text-sm font-medium'>
                {object.uploadState.minimumBlockDepth ? (
                  <a
                    href={getBlockExplorerUrl(
                      network.id,
                      object.uploadState.minimumBlockDepth,
                    )}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='hover:text-accent-hover text-accent hover:underline'
                  >
                    {formatNumberWithCommas(
                      object.uploadState.minimumBlockDepth,
                    )}
                  </a>
                ) : (
                  'N/A'
                )}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Archive blocks count:
              </span>
              <span className='text-sm font-medium'>0</span>
            </div>
          </div>
        </div>
      </div>
      <div className='rounded-lg border border-gray-200 p-6 dark:border-gray-200 bg-background'>
        <h2 className='mb-4 flex items-center text-lg font-medium text-gray-900 dark:text-gray-100'>
          <IconWithTooltip
            icon={
              object.metadata.uploadOptions?.encryption?.algorithm ===
                undefined ||
              object.metadata.uploadOptions?.encryption?.algorithm === null ? (
                <LockOpenIcon className='mr-2 h-5 w-5 text-gray-500' />
              ) : (
                <LockClosedIcon className='mr-2 h-5 w-5 text-gray-500' />
              )
            }
            tooltip={
              object.metadata.uploadOptions?.encryption?.algorithm
                ? 'This file is encrypted'
                : 'This file is not encrypted'
            }
          />
          Upload Options
        </h2>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              Encryption:
            </span>
            <span
              className={`text-sm font-medium ${
                object.metadata.uploadOptions?.encryption?.algorithm
                  ? 'text-green-600'
                  : 'text-yellow-600'
              }`}
            >
              {object.metadata.uploadOptions?.encryption?.algorithm ||
                'Disabled'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              Compression:
            </span>
            <span className='text-sm font-medium'>
              {object.metadata.uploadOptions?.compression?.algorithm ||
                'Disabled'}
            </span>
          </div>
        </div>
      </div>
      <div className='rounded-lg border border-gray-200 p-6 bg-background'>
        <h2 className='mb-4 text-lg font-medium text-gray-900 dark:text-gray-100'>
          Preview
        </h2>
        <div className='overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800'>
          <FilePreview metadata={object.metadata} />
        </div>
      </div>
    </div>
  );
};

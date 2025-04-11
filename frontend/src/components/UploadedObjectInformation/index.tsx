import { OwnerRole, ObjectInformation } from '@auto-drive/models';
import { getTypeFromMetadata } from 'utils/file';
import { useUserStore } from 'globalStates/user';
import { useCallback, useMemo, useState } from 'react';
import { Button } from 'components/common/Button';
import { ObjectShareModal } from '@/components/FileTables/common/ObjectShareModal';
import { ObjectDeleteModal } from '@/components/FileTables/common/ObjectDeleteModal';
import { Loader } from 'lucide-react';
import { ObjectDownloadModal } from '@/components/FileTables/common/ObjectDownloadModal';
import { FilePreview } from '@/components/ObjectDetails/FilePreview';
import { FolderPreview } from '../ObjectDetails/FolderPreview';
import {
  ArrowDownTrayIcon,
  ShareIcon,
  TrashIcon,
  DocumentIcon,
  LockClosedIcon,
  LockOpenIcon,
  PhotoIcon,
  InformationCircleIcon,
  CloudArrowUpIcon,
} from '@heroicons/react/24/outline';
import { EXTERNAL_ROUTES } from '@/constants/routes';
import { NetworkId } from '@/constants/networks';
import { useNetwork } from 'contexts/network';
import bytes from 'bytes';
import { formatNumberWithCommas } from '@/utils/number';

const getBlockExplorerUrl = (
  networkId: NetworkId,
  blockDepth?: number,
): string => {
  if (!blockDepth) return '#';
  return (
    EXTERNAL_ROUTES.astral + `/${networkId}/consensus/blocks/${blockDepth}`
  );
};

export const UploadedObjectInformation = ({
  object,
}: {
  object: ObjectInformation | null;
}) => {
  const { network } = useNetwork();

  const [downloadModalCid, setDownloadModalCid] = useState<string | null>(null);
  const [shareModalCid, setShareModalCid] = useState<string | null>(null);
  const [deleteModalCid, setDeleteModalCid] = useState<string | null>(null);
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

  const fileIcon =
    object.metadata.type === 'file' ? (
      object.metadata.mimeType?.startsWith('image/') ? (
        <PhotoIcon className='h-6 w-6 text-blue-900' />
      ) : (
        <DocumentIcon className='h-6 w-6 text-blue-900' />
      )
    ) : (
      <DocumentIcon className='h-6 w-6 text-blue-900' />
    );

  return (
    <div className='mx-auto flex max-w-4xl flex-grow flex-col gap-6'>
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
          <div className='rounded-lg bg-blue-100 p-2'>{fileIcon}</div>
          <div>
            <h1 className='text-xl font-semibold text-gray-900'>
              {object.metadata.name ?? 'Unnamed'}
            </h1>
            <p className='text-sm text-gray-500'>
              {getTypeFromMetadata(object.metadata)} •{' '}
              {bytes(Number(object.metadata.totalSize))}
            </p>
          </div>
        </div>
        <div className='flex space-x-2'>
          <Button
            variant='lightAccent'
            className='inline-flex items-center text-sm'
            onClick={handleDownload}
          >
            <ArrowDownTrayIcon className='mr-2 h-4 w-4' />
            Download
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
            variant='danger'
            className='inline-flex items-center text-sm disabled:hidden'
            onClick={handleDelete}
            disabled={!hasFileOwnership}
          >
            <TrashIcon className='mr-2 h-4 w-4' />
            Remove
          </Button>
        </div>
      </div>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        <div className='rounded-lg bg-gray-50 p-6'>
          <h2 className='mb-4 flex items-center text-lg font-medium text-gray-900'>
            <InformationCircleIcon className='mr-2 h-5 w-5 text-gray-500' />
            Metadata
          </h2>
          <div className='space-y-3'>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Name:</span>
              <span className='text-sm font-medium'>
                {object.metadata.name ?? 'Unnamed'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Type:</span>
              <span className='text-sm font-medium'>
                {getTypeFromMetadata(object.metadata)}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Size:</span>
              <span className='text-sm font-medium'>
                {bytes(Number(object.metadata.totalSize))}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Owner:</span>
              <span className='text-sm font-medium'>
                {isOwner ? 'You' : 'Unknown'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Uploaded Nodes:</span>
              <span className='text-sm font-medium'>
                {object.uploadState.uploadedNodes ?? 'Processing'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Total Nodes:</span>
              <span className='text-sm font-medium'>
                {object.uploadState.totalNodes ?? 'Processing'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Block range:</span>
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
              <span className='text-sm text-gray-500'>
                Archive blocks count:
              </span>
              <span className='text-sm font-medium'>0</span>
            </div>
          </div>
        </div>
        <div className='rounded-lg bg-gray-50 p-6'>
          <h2 className='mb-4 flex items-center text-lg font-medium text-gray-900'>
            <CloudArrowUpIcon className='mr-2 h-5 w-5 text-gray-500' />
            Upload Status
          </h2>
          <div className='space-y-3'>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Total Nodes:</span>
              <span className='text-sm font-medium'>
                {object.uploadState.totalNodes}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Uploaded Nodes:</span>
              <span className='text-sm font-medium'>
                {object.uploadState.uploadedNodes}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500'>Block range:</span>
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
              <span className='text-sm text-gray-500'>
                Archive blocks count:
              </span>
              <span className='text-sm font-medium'>0</span>
            </div>
          </div>
        </div>
      </div>
      <div className='rounded-lg bg-gray-50 p-6'>
        <h2 className='mb-4 flex items-center text-lg font-medium text-gray-900'>
          {object.metadata.uploadOptions?.encryption?.algorithm === undefined ||
          object.metadata.uploadOptions?.encryption?.algorithm === null ? (
            <LockOpenIcon className='mr-2 h-5 w-5 text-gray-500' />
          ) : (
            <LockClosedIcon className='mr-2 h-5 w-5 text-gray-500' />
          )}
          Upload Options
        </h2>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500'>Encryption:</span>
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
            <span className='text-sm text-gray-500'>Compression:</span>
            <span className='text-sm font-medium'>
              {object.metadata.uploadOptions?.compression?.algorithm ||
                'Disabled'}
            </span>
          </div>
        </div>
      </div>
      <div className='rounded-lg bg-gray-50 p-6'>
        <h2 className='mb-4 text-lg font-medium text-gray-900'>Preview</h2>
        <div className='overflow-hidden rounded-lg border border-gray-200'>
          {object.metadata.type === 'file' ? (
            <FilePreview metadata={object.metadata} />
          ) : (
            <FolderPreview metadata={object.metadata} />
          )}
        </div>
      </div>
    </div>
  );
};

import { ObjectInformation } from '@auto-drive/models';
import { IconWithTooltip } from '../../atoms/IconWithTooltip';
import {
  CloudArrowUpIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { getTypeFromMetadata } from '../../../utils/file';
import { formatBytes, formatNumberWithCommas } from '../../../utils/number';
import { formatDate } from '../../../utils/time';
import { formatCid } from '../../../utils/table';
import { EXTERNAL_ROUTES, ROUTES } from '@auto-drive/ui';
import Link from 'next/link';
import { useNetwork } from 'contexts/network';
import { CopiableText } from '../../atoms/CopiableText';

export const ObjectUploadDetails = ({
  object,
  ownerPublicIds,
  myPublicId,
  ownerAccountIds,
}: {
  object: ObjectInformation;
  ownerPublicIds: string[];
  myPublicId: string | null;
  /** publicId → current account ID; only filled in for admin viewers. */
  ownerAccountIds: Record<string, string>;
}) => {
  const { network } = useNetwork();
  const { minimumBlockDepth, maximumBlockDepth } = object.uploadState;

  const blockRangeDisplay =
    minimumBlockDepth != null ? (
      <span className='flex gap-1'>
        <a
          href={EXTERNAL_ROUTES.explorer.block(minimumBlockDepth)}
          target='_blank'
          rel='noopener noreferrer'
          className='text-primary hover:text-primary/80 hover:underline'
        >
          {formatNumberWithCommas(minimumBlockDepth)}
        </a>
        {maximumBlockDepth != null &&
          maximumBlockDepth !== minimumBlockDepth && (
            <>
              <span className='text-gray-400'>→</span>
              <a
                href={EXTERNAL_ROUTES.explorer.block(maximumBlockDepth)}
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary hover:text-primary/80 hover:underline'
              >
                {formatNumberWithCommas(maximumBlockDepth)}
              </a>
            </>
          )}
      </span>
    ) : (
      'N/A'
    );

  return (
    <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
      <div className='rounded-lg border border-border bg-card p-6'>
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
              {formatBytes(Number(object.metadata.totalSize))}
            </span>
          </div>
          {object.metadata.type === 'file' && (
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Chunks:
              </span>
              <span className='text-sm font-medium'>
                {object.metadata.totalChunks ?? 'N/A'}
              </span>
            </div>
          )}
          {object.metadata.type === 'folder' && (
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Total Files:
              </span>
              <span className='text-sm font-medium'>
                {object.metadata.totalFiles ?? 'N/A'}
              </span>
            </div>
          )}
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              Uploaded:
            </span>
            <span className='text-sm font-medium'>
              {object.createdAt ? formatDate(object.createdAt) : 'N/A'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              Owner:
            </span>
            <span className='flex flex-col items-end gap-1 text-sm font-medium'>
              {ownerPublicIds.length === 0
                ? 'Unknown'
                : ownerPublicIds.map((publicId) => (
                    <span key={publicId} className='flex items-center gap-2'>
                      {publicId === myPublicId && (
                        <span className='text-gray-500'>You</span>
                      )}
                      {ownerAccountIds[publicId] ? (
                        <Link
                          href={ROUTES.adminOrganization(
                            network.id,
                            ownerAccountIds[publicId],
                          )}
                          className='font-mono text-primary hover:underline'
                          title='Open account'
                        >
                          {formatCid(publicId)}
                        </Link>
                      ) : (
                        <CopiableText
                          text={publicId}
                          displayText={formatCid(publicId)}
                          className='font-mono'
                        />
                      )}
                    </span>
                  ))}
            </span>
          </div>
          {object.publishedObjectId && (
            <div className='flex justify-between'>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                Published ID:
              </span>
              <span
                className='font-mono text-sm font-medium'
                title={object.publishedObjectId}
              >
                {formatCid(object.publishedObjectId)}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className='rounded-lg border border-border bg-card p-6'>
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
              {object.uploadState.totalNodes ?? 'N/A'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              Uploaded Nodes:
            </span>
            <span className='text-sm font-medium'>
              {object.uploadState.uploadedNodes ?? 'N/A'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              Archived Nodes:
            </span>
            <span className='text-sm font-medium'>
              {object.uploadState.archivedNodes ?? 'N/A'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              Block range:
            </span>
            <span className='text-sm font-medium'>{blockRangeDisplay}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

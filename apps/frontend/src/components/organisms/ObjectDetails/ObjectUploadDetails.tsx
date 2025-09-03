import { ObjectInformation } from '@auto-drive/models';
import { IconWithTooltip } from '../../atoms/IconWithTooltip';
import {
  CloudArrowUpIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { getTypeFromMetadata } from '../../../utils/file';
import { formatNumberWithCommas } from '../../../utils/number';
import { EXTERNAL_ROUTES } from '@auto-drive/ui';
import { useNetwork } from '../../../contexts/network';
import bytes from 'bytes';

export const ObjectUploadDetails = ({
  object,
  isOwner,
}: {
  object: ObjectInformation;
  isOwner: boolean;
}) => {
  const { network } = useNetwork();

  return (
    <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
      <div className='dark:bg-darkWhite rounded-lg border border-gray-200 p-6 dark:border-gray-200'>
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
                  href={EXTERNAL_ROUTES.explorer.block(
                    network.id,
                    object.uploadState.minimumBlockDepth,
                  )}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='hover:text-accent-hover text-accent hover:underline'
                >
                  {formatNumberWithCommas(object.uploadState.minimumBlockDepth)}
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
      <div className='dark:bg-darkWhite rounded-lg border border-gray-200 p-6'>
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
                  href={EXTERNAL_ROUTES.explorer.block(
                    network.id,
                    object.uploadState.minimumBlockDepth,
                  )}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='hover:text-accent-hover text-accent hover:underline'
                >
                  {formatNumberWithCommas(object.uploadState.minimumBlockDepth)}
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
  );
};

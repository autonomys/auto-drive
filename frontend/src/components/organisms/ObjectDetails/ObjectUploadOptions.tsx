import { ObjectInformation } from '@auto-drive/models';
import { IconWithTooltip } from '../../atoms/IconWithTooltip';
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/24/outline';

export const ObjectUploadOptions = ({
  object,
}: {
  object: ObjectInformation;
}) => {
  return (
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
            {object.metadata.uploadOptions?.encryption?.algorithm || 'Disabled'}
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
  );
};

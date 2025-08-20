'use client';

import { OwnerRole, ObjectInformation } from '@auto-drive/models';
import { getTypeFromMetadata } from 'utils/file';
import { useUserStore } from 'globalStates/user';
import { useMemo } from 'react';
import { Loader } from 'lucide-react';
import { FilePreview } from '@/components/molecules/FilePreview';
import { IconByFileType } from '@/components/atoms/IconByFileType';
import { GoBackButton } from '@/components/atoms/GoBackButton';
import { ObjectDetailsTags } from './ObjectDetailsTags';
import { ObjectDetailsActions } from './ObjectDetailsActions';
import { ObjectUploadDetails } from './ObjectUploadDetails';
import { ObjectUploadOptions } from './ObjectUploadOptions';

export const ObjectDetails = ({
  object,
}: {
  object: ObjectInformation | null;
}) => {
  const user = useUserStore(({ user }) => user);

  const owners = useMemo(() => {
    return object?.owners.sort((a, b) => a.role.localeCompare(b.role));
  }, [object?.owners]);

  const isOwner = !!owners?.some(
    (o) =>
      o.oauthProvider === user?.oauthProvider &&
      o.oauthUserId === user?.oauthUserId &&
      o.role === OwnerRole.ADMIN,
  );

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
      <div className='flex items-center justify-start'>
        <GoBackButton />
      </div>
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-3'>
          <div className='rounded-lg bg-blue-100 p-2 dark:bg-darkPrimary'>
            <IconByFileType
              fileType={getTypeFromMetadata(object.metadata) ?? ''}
            />
          </div>
          <ObjectDetailsTags object={object} />
        </div>
        <ObjectDetailsActions isOwner={isOwner} object={object} />
      </div>
      <ObjectUploadDetails object={object} isOwner={isOwner} />
      <ObjectUploadOptions object={object} />
      <div className='rounded-lg border border-gray-200 p-6 dark:bg-darkWhite'>
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

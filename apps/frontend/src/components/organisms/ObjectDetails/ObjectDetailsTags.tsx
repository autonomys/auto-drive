import {
  ObjectInformation,
  UserRole,
  isBanned,
  isInsecure,
  isToBeReviewed,
} from '@auto-drive/models';
import { ConditionalRender } from '../../atoms/ConditionalRender';
import { RoleProtected } from '../../atoms/RoleProtected';
import { Badge } from '@/components/atoms/Badge';
import { getTypeFromMetadata } from 'utils/file';
import { formatBytes } from '../../../utils/number';

export const ObjectDetailsTags = ({
  object,
  isCached,
}: {
  object: ObjectInformation;
  isCached: boolean | null;
}) => {
  return (
    <div>
      <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
        {object.metadata.name ?? 'Unnamed'}
      </h1>
      <p className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
        {getTypeFromMetadata(object.metadata)} •{' '}
        {formatBytes(Number(object.metadata.totalSize), 0)}
        <Badge label={object.status} status={object.status} />
        <ConditionalRender condition={isInsecure(object.tags)}>
          <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
            Insecure
          </span>
        </ConditionalRender>
        <ConditionalRender condition={isToBeReviewed(object.tags)}>
          <span className='ml-2 rounded-lg bg-orange-500 p-1 text-xs font-semibold text-white'>
            Reported
          </span>
        </ConditionalRender>
        <ConditionalRender condition={isBanned(object.tags)}>
          <span className='ml-2 rounded-lg bg-red-500 p-1 text-xs font-semibold text-white'>
            Banned
          </span>
        </ConditionalRender>
        {isCached !== null && (
          <RoleProtected roles={[UserRole.Admin]}>
            <span
              className={`ml-2 rounded-lg p-1 text-xs font-semibold text-white ${
                isCached ? 'bg-green-600' : 'bg-gray-500'
              }`}
              title='Visible to admins only'
            >
              {isCached ? 'Cached' : 'Not cached'}
            </span>
          </RoleProtected>
        )}
      </p>
    </div>
  );
};

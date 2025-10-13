import { ObjectInformation, ObjectTag } from '@auto-drive/models';
import { ConditionalRender } from '../../atoms/ConditionalRender';
import { Badge } from '@/components/atoms/Badge';
import { getTypeFromMetadata } from 'utils/file';
import { formatBytes } from '../../../utils/number';

export const ObjectDetailsTags = ({
  object,
}: {
  object: ObjectInformation;
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
        <ConditionalRender condition={object.tags.includes(ObjectTag.Banned)}>
          <span className='ml-2 rounded-lg bg-red-500 p-1 text-xs font-semibold text-white'>
            Banned
          </span>
        </ConditionalRender>
      </p>
    </div>
  );
};

import { ObjectSummary } from '@auto-drive/models';
import bytes from 'bytes';
import { getTypeFromMetadata } from 'utils/file';
import { InternalLink } from 'components/common/InternalLink';
import { useNetwork } from 'contexts/network';
import { ROUTES } from 'constants/routes';

export const Metadata = ({ object }: { object: ObjectSummary }) => {
  const { network } = useNetwork();
  return (
    <div className='rounded-lg border border-[#202124] border-opacity-20 bg-background p-4 text-xs bg-background text-foreground'>
      <div className='mb-4 flex flex-col'>
        <div className='flex justify-between'>
          <h4 className='text-wrap text-sm font-medium text-foreground'>
            {object.name}
          </h4>
          {object.uploadState.archivedNodes ===
            object.uploadState.totalNodes && (
            <span className='h-fit rounded-md bg-green-300 px-2 py-1 font-semibold text-foreground'>
              ARCHIVED
            </span>
          )}
        </div>
        <p className='text-gray-500 text-foreground'>
          Size: {bytes(Number(object.size))}
        </p>
        <p>
          CID: <span className='text-blue-500'>{object.headCid}</span>
        </p>
      </div>
      <div className='grid grid-cols-2 gap-x-4 gap-y-2 font-light text-foreground'>
        <div className='flex'>
          <span>Type:</span>
          <span className='ml-[4px]'>{getTypeFromMetadata(object)}</span>
        </div>
        <div className='flex'>
          <span>{'Owner: '}</span>
          <span className='ml-[4px]'>You</span>
        </div>
        <div className='flex'>
          <span>Total Nodes: </span>
          <span className='ml-[4px]'>{object.uploadState.totalNodes}</span>
        </div>
        <div className='flex'>
          <span>Uploaded Nodes: </span>
          <span className='ml-[4px]'>{object.uploadState.uploadedNodes}</span>
        </div>
        <div className='flex'>
          <span>Minimum block depth:</span>
          <span className='ml-[4px]'>
            {object.uploadState.minimumBlockDepth ?? 'N/A'}
          </span>
        </div>
        <div className='flex'>
          <span>Maximum block depth:</span>
          <span className='ml-[4px]'>
            {object.uploadState.maximumBlockDepth ?? 'N/A'}
          </span>
        </div>
        <div className='flex'>
          <span>Archive blocks count:</span>
          <span className='ml-[4px]'>
            {object.uploadState.archivedNodes ?? 'N/A'}
          </span>
        </div>
      </div>
      <div className='flex justify-end'>
        <InternalLink href={ROUTES.objectDetails(network.id, object.headCid)}>
          <span className='mt-4 font-semibold text-primary hover:cursor-pointer text-foreground'>
            See more
          </span>
        </InternalLink>
      </div>
    </div>
  );
};

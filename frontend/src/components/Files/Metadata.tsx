import { ObjectSummary } from '../../models/UploadedObjectMetadata';
import bytes from 'bytes';
import { getTypeFromMetadata } from '../../utils/file';
import { InternalLink } from '../common/InternalLink';
import { useNetwork } from '../../contexts/network';
import { ROUTES } from '../../constants/routes';

export const Metadata = ({ object }: { object: ObjectSummary }) => {
  const { network } = useNetwork();
  return (
    <div className='dark:bg-darkWhiteHover dark:text-darkBlack rounded-lg border border-[#202124] border-opacity-20 bg-white p-4 text-xs'>
      <div className='mb-4 flex flex-col'>
        <div className='flex justify-between'>
          <h4 className='dark:text-darkBlack text-wrap text-sm font-medium text-black'>
            {object.name}
          </h4>
          {object.uploadStatus.archivedNodes ===
            object.uploadStatus.totalNodes && (
            <span className='h-fit rounded-md bg-green-300 px-2 py-1 font-semibold text-black'>
              ARCHIVED
            </span>
          )}
        </div>
        <p className='dark:text-darkBlack text-gray-500'>
          Size: {bytes(Number(object.size))}
        </p>
        <p>
          CID: <span className='text-blue-500'>{object.headCid}</span>
        </p>
      </div>
      <div className='dark:text-darkBlack grid grid-cols-2 gap-x-4 gap-y-2 font-light text-black'>
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
          <span className='ml-[4px]'>{object.uploadStatus.totalNodes}</span>
        </div>
        <div className='flex'>
          <span>Uploaded Nodes: </span>
          <span className='ml-[4px]'>{object.uploadStatus.uploadedNodes}</span>
        </div>
        <div className='flex'>
          <span>Minimum block depth:</span>
          <span className='ml-[4px]'>
            {object.uploadStatus.minimumBlockDepth ?? 'N/A'}
          </span>
        </div>
        <div className='flex'>
          <span>Maximum block depth:</span>
          <span className='ml-[4px]'>
            {object.uploadStatus.maximumBlockDepth ?? 'N/A'}
          </span>
        </div>
        <div className='flex'>
          <span>Archive blocks count:</span>
          <span className='ml-[4px]'>
            {object.uploadStatus.archivedNodes ?? 'N/A'}
          </span>
        </div>
      </div>
      <div className='flex justify-end'>
        <InternalLink href={ROUTES.objectDetails(network.id, object.headCid)}>
          <span className='dark:text-darkBlack mt-4 font-semibold text-primary hover:cursor-pointer'>
            See more
          </span>
        </InternalLink>
      </div>
    </div>
  );
};

import { UploadedObjectMetadata } from '../../models/UploadedObjectMetadata';
import { FileCard } from '../../components/common/FileCard';

export const SearchResult = ({
  objects,
}: {
  objects: UploadedObjectMetadata[];
}) => {
  return (
    <div className='grid grid-cols-4 gap-4'>
      {objects && objects.length > 0 ? (
        objects.map(({ metadata }) => (
          <FileCard
            key={metadata.dataCid}
            metadata={{
              type: metadata.type,
              name: metadata.name ?? '',
              totalSize: metadata.totalSize,
              cid: metadata.dataCid,
            }}
          />
        ))
      ) : (
        <div className='flex h-[50%] w-full flex-col items-center justify-center text-center text-xl text-gray-500'>
          No root objects, upload some!
        </div>
      )}
    </div>
  );
};

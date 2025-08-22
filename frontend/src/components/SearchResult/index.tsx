import { FileCard } from 'components/common/FileCard';

type BaseMetadata = {
  cid: string;
  name: string;
  size: bigint;
  type: 'file' | 'folder';
};

export const SearchResult = ({ objects }: { objects: BaseMetadata[] }) => {
  return (
    <div className='grid grid-cols-4 gap-4'>
      {objects && objects.length > 0 ? (
        objects.map(({ cid, name, size, type }) => (
          <FileCard
            key={cid}
            metadata={{
              type,
              name,
              size,
              cid,
            }}
          />
        ))
      ) : (
        <div className='flex h-[50%] w-full flex-col items-center justify-center text-center text-xl text-gray-500 text-foreground'>
          No objects found!
        </div>
      )}
    </div>
  );
};

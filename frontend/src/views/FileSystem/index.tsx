import { FC, PropsWithoutRef } from 'react';
import { FileCard } from 'components/common/FileCard';
import { UploadedObjectMetadata } from 'models/UploadedObjectMetadata';

export const FS: FC<PropsWithoutRef<{ metadata: UploadedObjectMetadata }>> = ({
  metadata,
}) => {
  if (metadata.metadata.type === 'file') {
    throw new Error('File type not supported');
  }

  return (
    <div className='grid grid-cols-4 gap-4'>
      {metadata.metadata.children.map((metadata) => {
        return <FileCard key={metadata.cid} metadata={metadata} />;
      })}
    </div>
  );
};

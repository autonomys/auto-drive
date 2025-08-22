import { FC, PropsWithoutRef } from 'react';
import { FileCard } from 'components/molecules/FileCard';
import { ObjectInformation } from '@auto-drive/models';

export const FS: FC<PropsWithoutRef<{ information: ObjectInformation }>> = ({
  information,
}) => {
  if (information.metadata.type === 'file') {
    throw new Error('File type not supported');
  }

  return (
    <div className='grid grid-cols-4 gap-4'>
      {information.metadata.children.map((metadata) => {
        return (
          <FileCard
            key={metadata.cid}
            metadata={{
              type: metadata.type,
              name: metadata.name,
              size: metadata.totalSize,
              cid: metadata.cid,
            }}
          />
        );
      })}
    </div>
  );
};

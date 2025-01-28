import { OffchainFolderMetadata } from '@autonomys/auto-drive';
import { getObjectDetailsPath } from '../../views/ObjectDetails';
import { useNetwork } from '../../contexts/network';
import { useCallback } from 'react';

export const NoPreviewAvailable = () => (
  <div className='flex h-full items-center justify-center'>
    <div className='text-center text-gray-500'>File is not previewable</div>
  </div>
);

export const FolderPreview = ({
  metadata,
}: {
  metadata: OffchainFolderMetadata;
}) => {
  const { network } = useNetwork();

  const getPath = useCallback(
    (cid: string) => getObjectDetailsPath(network.id, cid),
    [network],
  );

  return (
    <div className='flex h-full flex-col items-center justify-center gap-4'>
      <div className='text-center text-gray-500'>{metadata.name}</div>
      <ul>
        {metadata.children.map((child) => (
          <a
            className='text-gray-500 hover:text-gray-700'
            href={getPath(child.cid)}
            key={child.cid}
          >
            <li>{`${child.cid} - ${child.name}`}</li>
          </a>
        ))}
      </ul>
    </div>
  );
};

import { OffchainFolderMetadata } from '@autonomys/auto-drive';
import { useCallback } from 'react';
import { useNetwork } from 'contexts/network';
import { ROUTES } from 'constants/routes';

export const FolderPreview = ({
  metadata,
}: {
  metadata: OffchainFolderMetadata;
}) => {
  const { network } = useNetwork();

  const getPath = useCallback(
    (cid: string) => ROUTES.objectDetails(network.id, cid),
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

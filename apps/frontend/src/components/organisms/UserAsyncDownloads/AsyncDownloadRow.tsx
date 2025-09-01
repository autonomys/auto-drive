import { AsyncDownload } from '@auto-drive/models';
import { useNetwork } from '../../../contexts/network';
import { useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { ROUTES } from '../../../constants/routes';
import { AsyncStatusBadge } from './AsyncStatusBadge';
import { shortenString } from '../../../utils/misc';
import { XIcon } from 'lucide-react';
import { useUserAsyncDownloadsStore } from './state';

export const AsyncDownloadRow = ({
  asyncDownload,
}: {
  asyncDownload: AsyncDownload;
}) => {
  const { api, network } = useNetwork();
  const updateAsyncDownloads = useUserAsyncDownloadsStore((e) => e.update);

  const onDismiss = useCallback(() => {
    const toastId = toast.loading('Dismissing...');
    api
      .dismissAsyncDownload(asyncDownload.id)
      .then(() => {
        toast.success('Dismissed', { id: toastId });
        updateAsyncDownloads();
      })
      .catch(() => {
        toast.error('Failed to dismiss', { id: toastId });
      });
  }, [api, asyncDownload.id, updateAsyncDownloads]);

  const href = ROUTES.objectDetails(network.id, asyncDownload.cid);

  return (
    <div className='flex items-center justify-between border-b border-gray-200 pb-2'>
      <span className='flex items-center gap-2'>
        <a
          href={href}
          target='_blank'
          rel='noreferrer'
          className='hover:text-blue-800 hover:underline dark:text-white dark:hover:text-blue-400'
        >
          {shortenString(asyncDownload.cid, 10)}
        </a>
      </span>

      <span className='flex items-center gap-4'>
        <AsyncStatusBadge download={asyncDownload} />
        <button
          onClick={onDismiss}
          className='hover:text-red-400 dark:text-white dark:hover:text-red-400'
        >
          <XIcon className='h-4 w-4' />
        </button>
      </span>
    </div>
  );
};

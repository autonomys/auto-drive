import { ObjectInformation, ObjectTag } from '@auto-drive/models';
import { Button } from '@auto-drive/ui';
import { cn } from '@/utils/cn';
import {
  ArrowDownTrayIcon,
  ShareIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useState } from 'react';
import { useUserStore } from 'globalStates/user';
import toast from 'react-hot-toast';
import { useNetwork } from '../../../contexts/network';
import { ObjectDownloadModal } from '../../molecules/ObjectDownloadModal';
import { ObjectShareModal } from '../../molecules/ObjectShareModal';
import { ObjectDeleteModal } from '../../molecules/ObjectDeleteModal';

export const ObjectDetailsActions = ({
  object,
  isOwner,
}: {
  object: ObjectInformation;
  isOwner: boolean;
}) => {
  const { user } = useUserStore();
  const { api } = useNetwork();
  const [downloadModalCid, setDownloadModalCid] = useState<string | null>(null);
  const [shareModalCid, setShareModalCid] = useState<string | null>(null);
  const [deleteModalCid, setDeleteModalCid] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);

  const hasFileOwnership = object?.owners.some(
    (o) =>
      o.oauthProvider === user?.oauthProvider &&
      o.oauthUserId === user?.oauthUserId,
  );

  const handleDownload = useCallback(async () => {
    if (!object?.metadata.dataCid) {
      return;
    }
    setDownloadModalCid(object.metadata.dataCid);
  }, [object?.metadata.dataCid]);

  const handleShare = useCallback(() => {
    setShareModalCid(object?.metadata.dataCid ?? null);
  }, [object?.metadata.dataCid]);

  const handleDelete = useCallback(() => {
    setDeleteModalCid(object?.metadata.dataCid ?? null);
  }, [object?.metadata.dataCid]);

  const handleReport = useCallback(async () => {
    if (!object?.metadata.dataCid) {
      return;
    }

    setIsReporting(true);
    try {
      await api.reportFile(object.metadata.dataCid);
      toast.success('File has been reported successfully');
    } catch (error) {
      console.error('Report error:', error);
      toast.error('Failed to report file. Please try again.');
    } finally {
      setIsReporting(false);
    }
  }, [api, object?.metadata.dataCid]);

  return (
    <div className='flex space-x-2'>
      <Button
        variant='primary'
        className={cn(
          'inline-flex items-center text-sm',
          object.tags.includes(ObjectTag.Banned) &&
            'cursor-not-allowed opacity-50',
        )}
        disabled={object.tags.includes(ObjectTag.Banned)}
        onClick={handleDownload}
      >
        <ArrowDownTrayIcon className='mr-2 h-4 w-4' />
        Download
        {object.tags.includes(ObjectTag.Banned) && (
          <span className='ml-2 text-xs text-gray-500'>(File is banned)</span>
        )}
      </Button>
      <Button
        variant='lightAccent'
        className='inline-flex items-center text-sm disabled:hidden'
        onClick={handleShare}
        disabled={!isOwner}
      >
        <ShareIcon className='mr-2 h-4 w-4' />
        Share
      </Button>
      <Button
        variant='lightDanger'
        className='inline-flex items-center text-sm disabled:hidden'
        onClick={handleDelete}
        disabled={!hasFileOwnership}
      >
        <TrashIcon className='mr-2 h-4 w-4' />
        Remove
      </Button>
      <Button
        variant='lightAccent'
        className='inline-flex items-center bg-orange-100 text-sm text-orange-700 hover:bg-orange-200'
        onClick={handleReport}
        disabled={
          isReporting ||
          object.tags.includes(ObjectTag.ToBeReviewed) ||
          object.tags.includes(ObjectTag.Banned)
        }
      >
        <ExclamationTriangleIcon className='mr-2 h-4 w-4' />
        {isReporting ? 'Reporting...' : 'Report'}
      </Button>
      <ObjectDownloadModal
        cid={downloadModalCid}
        onClose={() => setDownloadModalCid(null)}
      />
      <ObjectShareModal
        cid={shareModalCid}
        closeModal={() => setShareModalCid(null)}
      />
      <ObjectDeleteModal
        cid={deleteModalCid}
        closeModal={() => setDeleteModalCid(null)}
      />
    </div>
  );
};

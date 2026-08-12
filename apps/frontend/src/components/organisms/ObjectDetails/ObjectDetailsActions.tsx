import {
  ObjectInformation,
  isBanned,
  isToBeReviewed,
} from '@auto-drive/models';
import { Button } from '@auto-drive/ui';
import { cn } from '@/utils/cn';
import {
  ArrowDownTrayIcon,
  ShareIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  CloudArrowDownIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from 'globalStates/user';
import toast from 'react-hot-toast';
import { useNetwork } from '../../../contexts/network';
import { ObjectDownloadModal } from '../../molecules/ObjectDownloadModal';
import { ObjectShareModal } from '../../molecules/ObjectShareModal';
import { ObjectDeleteModal } from '../../molecules/ObjectDeleteModal';
import { useUserAsyncDownloadsStore } from '../UserAsyncDownloads/state';

export const ObjectDetailsActions = ({
  object,
  isOwner,
  isCached,
  reconstruction,
}: {
  object: ObjectInformation;
  isOwner: boolean;
  isCached: boolean | null;
  reconstruction?: {
    state: 'running' | 'idle';
    downloadedBytes: string;
    totalSize: string;
    startedAt: string | null;
  } | null;
}) => {
  const { user } = useUserStore();
  const { api } = useNetwork();
  const router = useRouter();
  const [downloadModalCid, setDownloadModalCid] = useState<string | null>(null);
  const [shareModalCid, setShareModalCid] = useState<string | null>(null);
  const [deleteModalCid, setDeleteModalCid] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const [isBringingToCache, setIsBringingToCache] = useState(false);
  const updateAsyncDownloads = useUserAsyncDownloadsStore((e) => e.update);

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
      // The tags shown here come from a server-fetched prop, so without this
      // the "reported" tag/disabled state won't show up until a manual reload.
      router.refresh();
    } catch (error) {
      console.error('Report error:', error);
      toast.error('Failed to report file. Please try again.');
    } finally {
      setIsReporting(false);
    }
  }, [api, object?.metadata.dataCid, router]);

  const handleBringToCache = useCallback(async () => {
    if (!object?.metadata.dataCid) {
      return;
    }

    setIsBringingToCache(true);
    try {
      await api.createAsyncDownload(object.metadata.dataCid);
      // The old copy ("File is being brought to cache") implied the work was
      // done. It only queues a retrieval that runs for minutes, and nothing
      // reported on it afterwards — so a user who came back to an unchanged
      // button concluded it had failed. Point them at the surface that does
      // track it, and let the polled cache state drive the button from here.
      toast.success(
        'Retrieving this file from the network. Progress is shown in Cached Downloads — it can take 20 minutes or more for large files.',
        { duration: 6000 },
      );
      updateAsyncDownloads();
    } catch (error) {
      console.error('Bring to cache error:', error);
      toast.error('Failed to start retrieval. Please try again.');
    } finally {
      setIsBringingToCache(false);
    }
  }, [api, object?.metadata.dataCid, updateAsyncDownloads]);

  // A retrieval already running for this object — started here, by the download
  // modal, or by another user, since the cache is shared.
  const isReconstructing = reconstruction?.state === 'running';
  const reconstructionPercentage = (() => {
    const total = Number(reconstruction?.totalSize ?? 0);
    const done = Number(reconstruction?.downloadedBytes ?? 0);
    return total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0;
  })();

  return (
    <div className='flex space-x-2'>
      <Button
        variant='primary'
        className={cn(
          'inline-flex items-center text-sm',
          isBanned(object.tags) && 'cursor-not-allowed opacity-50',
        )}
        disabled={isBanned(object.tags)}
        onClick={handleDownload}
      >
        <ArrowDownTrayIcon className='mr-2 h-4 w-4' />
        Download
        {isBanned(object.tags) && (
          <span className='ml-2 text-xs text-gray-500'>(File is banned)</span>
        )}
      </Button>
      {isCached === false && (
        <Button
          variant='primary'
          className={cn(
            'inline-flex items-center text-sm',
            (isBanned(object.tags) || isBringingToCache || isReconstructing) &&
              'cursor-not-allowed opacity-50',
          )}
          disabled={
            isBanned(object.tags) || isBringingToCache || isReconstructing
          }
          onClick={handleBringToCache}
        >
          <CloudArrowDownIcon className='mr-2 h-4 w-4' />
          {isReconstructing
            ? `Retrieving… ${reconstructionPercentage}%`
            : isBringingToCache
              ? 'Starting…'
              : 'Bring to Cache'}
        </Button>
      )}
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
          isReporting || isToBeReviewed(object.tags) || isBanned(object.tags)
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

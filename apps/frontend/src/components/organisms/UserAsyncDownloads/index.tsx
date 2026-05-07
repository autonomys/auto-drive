import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  MyUndismissedAsyncDownloadsDocument,
  MyUndismissedAsyncDownloadsQuery,
} from '../../../../gql/graphql';
import { useNetwork } from '../../../contexts/network';
import { useUserAsyncDownloadsStore } from './state';
import {
  AsyncDownload,
  AsyncDownloadStatus,
  DownloadStatus,
} from '@auto-drive/models';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { AsyncDownloadRow } from './AsyncDownloadRow';
import { Button } from '@auto-drive/ui';
import { cn } from '@/utils/cn';
import { Download } from 'lucide-react';
import { shortenString } from '../../../utils/misc';
import toast from 'react-hot-toast';

const POLL_INTERVAL_MS = 10_000;

export const UserAsyncDownloads = () => {
  const setFetcher = useUserAsyncDownloadsStore((e) => e.setFetcher);
  const asyncDownloads = useUserAsyncDownloadsStore((e) => e.asyncDownloads);
  const pendingAutoDownloads = useUserAsyncDownloadsStore(
    (e) => e.pendingAutoDownloads,
  );
  const removePendingAutoDownload = useUserAsyncDownloadsStore(
    (e) => e.removePendingAutoDownload,
  );
  const { gql, api, downloadService } = useNetwork();
  const updateAsyncDownloads = useUserAsyncDownloadsStore((e) => e.update);
  const [isOpen, setIsOpen] = useState(false);
  const autoDownloadingRef = useRef<Set<string>>(new Set());

  const dismissOutdatedAsyncDownloads = useCallback(async () => {
    let hasDismissedSome = false;
    for (const asyncDownload of asyncDownloads) {
      if (asyncDownload.status !== AsyncDownloadStatus.Completed) return;
      const status = await api.checkDownloadStatus(asyncDownload.cid);
      if (status === DownloadStatus.NotCached) {
        api.dismissAsyncDownload(asyncDownload.id);
        hasDismissedSome = true;
      }
    }
    if (hasDismissedSome) {
      updateAsyncDownloads();
    }
  }, [api, asyncDownloads, updateAsyncDownloads]);

  useEffect(() => {
    dismissOutdatedAsyncDownloads();
  }, [dismissOutdatedAsyncDownloads]);

  const fetcher = useCallback(async () => {
    const { data } = await gql.query<MyUndismissedAsyncDownloadsQuery>({
      query: MyUndismissedAsyncDownloadsDocument,
      fetchPolicy: 'network-only',
    });

    return (data?.async_downloads as AsyncDownload[]) ?? [];
  }, [gql]);

  useEffect(() => {
    setFetcher(fetcher);
  }, [fetcher, setFetcher]);

  // Periodic polling so background async downloads are detected even when
  // the download modal is closed.
  useEffect(() => {
    const hasPending = asyncDownloads.some(
      (d) => d.status === AsyncDownloadStatus.Pending,
    );
    const hasPendingAuto = pendingAutoDownloads.length > 0;
    if (!hasPending && !hasPendingAuto) return;

    const interval = setInterval(() => {
      updateAsyncDownloads();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [asyncDownloads, pendingAutoDownloads.length, updateAsyncDownloads]);

  // When a pending auto-download completes on the backend, trigger the
  // browser download automatically.
  useEffect(() => {
    if (pendingAutoDownloads.length === 0) return;

    for (const pending of pendingAutoDownloads) {
      if (autoDownloadingRef.current.has(pending.cid)) continue;

      const match = asyncDownloads.find((d) => d.cid === pending.cid);
      if (!match) continue;

      if (match.status === AsyncDownloadStatus.Failed) {
        removePendingAutoDownload(pending.cid);
        toast.error(
          match.errorMessage ||
            'Background download failed. Please try again.',
        );
        continue;
      }

      if (match.status !== AsyncDownloadStatus.Completed) continue;

      autoDownloadingRef.current.add(pending.cid);
      removePendingAutoDownload(pending.cid);

      const label = pending.fileName
        ? shortenString(pending.fileName, 30)
        : shortenString(pending.cid, 20);
      toast.success(`${label} is ready — downloading now`);

      downloadService
        .fetchFile(pending.cid, {
          password: pending.password,
          skipDecryption: pending.skipDecryption,
        })
        .then(() => {
          toast.success(`${label} downloaded`);
        })
        .catch((err) => {
          console.error('Auto-download failed:', err);
          toast.error(
            `Failed to download ${label}. Open Cached Downloads to retry.`,
          );
        })
        .finally(() => {
          autoDownloadingRef.current.delete(pending.cid);
        });
    }
  }, [
    asyncDownloads,
    pendingAutoDownloads,
    removePendingAutoDownload,
    downloadService,
  ]);

  const toggleModal = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  if (asyncDownloads.length === 0) {
    return null;
  }

  return (
    <div className='relative'>
      <Button
        variant='primary'
        className={cn(
          'flex items-center gap-1 text-sm',
          asyncDownloads.length > 0 && 'font-medium',
        )}
        onClick={toggleModal}
      >
        <Download className='h-4 w-4' />
        Cached Downloads ({asyncDownloads.length})
      </Button>

      <Transition show={isOpen} as={Fragment}>
        <Dialog
          as='div'
          className='fixed inset-0 z-10 overflow-y-auto'
          onClose={toggleModal}
        >
          <TransitionChild
            as={Fragment}
            enter='ease-out duration-300'
            enterFrom='opacity-0'
            enterTo='opacity-100'
            leave='ease-in duration-200'
            leaveFrom='opacity-100'
            leaveTo='opacity-0'
          >
            <div className='fixed inset-0 bg-black/25' />
          </TransitionChild>
          <div className='flex min-h-screen items-center justify-center px-4 pb-20 text-center'>
            <span
              className='inline-block h-screen align-middle'
              aria-hidden='true'
            >
              &#8203;
            </span>

            <TransitionChild
              as={Fragment}
              enter='ease-out duration-300'
              enterFrom='opacity-0 scale-95'
              enterTo='opacity-100 scale-100'
              leave='ease-in duration-200'
              leaveFrom='opacity-100 scale-100'
              leaveTo='opacity-0 scale-95'
            >
              <DialogPanel className='bg-background-hover inline-block flex h-[60vh] w-full max-w-md transform flex-col justify-between overflow-y-scroll rounded-2xl bg-background p-6 text-left align-middle shadow-xl transition-all'>
                <div>
                  <DialogTitle
                    as='h3'
                    className='text-lg font-medium leading-6 text-foreground'
                  >
                    Cached Downloads
                  </DialogTitle>
                  <div className='mt-4 flex flex-col gap-2'>
                    {asyncDownloads.map((asyncDownload) => (
                      <AsyncDownloadRow
                        key={asyncDownload.id}
                        asyncDownload={asyncDownload}
                      />
                    ))}
                  </div>
                </div>
                <div className='mt-4'>
                  <Button
                    variant='primary'
                    className='w-full justify-center text-sm font-medium hover:bg-background hover:text-foreground'
                    onClick={toggleModal}
                  >
                    Close
                  </Button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
};

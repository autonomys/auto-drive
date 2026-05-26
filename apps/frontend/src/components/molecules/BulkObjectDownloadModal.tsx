import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  isBanned,
  isInsecure,
  ObjectInformation,
  ObjectStatus,
} from '@auto-drive/models';
import { Button } from '@auto-drive/ui';
import toast from 'react-hot-toast';
import { useNetwork } from 'contexts/network';
import { useEncryptionStore } from 'globalStates/encryption';
import { InvalidDecryptKey } from 'utils/file';
import {
  ObjectDownloadAbortedError,
  runObjectDownloadFlow,
} from 'services/objectDownloadFlow';
import {
  BulkDownloadItem,
  BulkDownloadStatus,
  EncryptionChoice,
  hasEncryption,
  itemIsRunnable,
  resolveEncryptionOptions as resolveBulkEncryptionOptions,
  shouldSkipEncrypted,
  shouldSkipInsecure,
} from 'services/bulkObjectDownload';
import { formatBytes } from 'utils/number';
import { shortenString } from 'utils/misc';
import { useUserAsyncDownloadsStore } from '../organisms/UserAsyncDownloads/state';

const toastId = 'bulk-object-download-modal';

const statusLabel: Record<BulkDownloadStatus, string> = {
  pending: 'Pending',
  skipped: 'Skipped',
  checking: 'Checking',
  preparing: 'Preparing',
  downloading: 'Downloading',
  completed: 'Completed',
  failed: 'Failed',
};

const itemName = (item: BulkDownloadItem) =>
  item.information?.metadata.name ?? item.cid;

export const BulkObjectDownloadModal = ({
  cids,
  isOpen,
  onClose,
  onComplete,
}: {
  cids: string[];
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}) => {
  const network = useNetwork();
  const defaultPassword = useEncryptionStore((store) => store.password);
  const updateAsyncDownloads = useUserAsyncDownloadsStore((e) => e.update);
  const addPendingAutoDownload = useUserAsyncDownloadsStore(
    (e) => e.addPendingAutoDownload,
  );
  const [items, setItems] = useState<BulkDownloadItem[]>([]);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [hasConfirmedInsecure, setHasConfirmedInsecure] = useState(false);
  const [encryptionChoice, setEncryptionChoice] =
    useState<EncryptionChoice | null>(null);
  const [sharedPassword, setSharedPassword] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [pendingRetryStart, setPendingRetryStart] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const currentAsyncItemRef = useRef<{
    item: BulkDownloadItem;
    password?: string;
    skipDecryption: boolean;
  } | null>(null);

  const updateItem = useCallback(
    (cid: string, updater: (item: BulkDownloadItem) => BulkDownloadItem) => {
      setItems((current) =>
        current.map((item) => (item.cid === cid ? updater(item) : item)),
      );
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      currentAsyncItemRef.current = null;
      setItems([]);
      setIsLoadingMetadata(false);
      setHasConfirmedInsecure(false);
      setEncryptionChoice(null);
      setSharedPassword('');
      setIsRunning(false);
      setIsComplete(false);
      setPendingRetryStart(false);
      return;
    }

    let cancelled = false;
    setIsLoadingMetadata(true);
    setItems(cids.map((cid) => ({ cid, status: 'pending' })));

    Promise.all(
      cids.map(async (cid): Promise<BulkDownloadItem> => {
        try {
          const information =
            await network.api.fetchUploadedObjectMetadata(cid);
          if (isBanned(information.tags)) {
            return {
              cid,
              information,
              status: 'skipped',
              skippedReason: 'File is banned',
            };
          }
          if (
            information.status === ObjectStatus.Processing ||
            information.uploadState.totalNodes === null
          ) {
            return {
              cid,
              information,
              status: 'skipped',
              skippedReason: 'Upload is still processing',
            };
          }
          return { cid, information, status: 'pending' };
        } catch (error) {
          return {
            cid,
            status: 'failed',
            error:
              error instanceof Error && error.message
                ? error.message
                : 'Failed to load metadata',
          };
        }
      }),
    ).then((loadedItems) => {
      if (cancelled) return;
      setItems(loadedItems);
      setIsLoadingMetadata(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cids, isOpen, network.api]);

  const insecureItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === 'pending' &&
          item.information &&
          isInsecure(item.information.tags),
      ),
    [items],
  );

  const encryptedItemsNeedingDecision = useMemo(
    () =>
      defaultPassword
        ? []
        : items.filter(
            (item) => item.status === 'pending' && hasEncryption(item),
          ),
    [defaultPassword, items],
  );

  const canStart =
    !isLoadingMetadata &&
    !isRunning &&
    items.some(itemIsRunnable) &&
    (insecureItems.length === 0 || hasConfirmedInsecure) &&
    (encryptedItemsNeedingDecision.length === 0 ||
      encryptionChoice === 'download-encrypted' ||
      encryptionChoice === 'skip' ||
      (encryptionChoice === 'shared-password' && sharedPassword.length > 0));

  const encryptionContext = useMemo(
    () => ({ defaultPassword, encryptionChoice, sharedPassword }),
    [defaultPassword, encryptionChoice, sharedPassword],
  );

  const resolveEncryptionOptions = useCallback(
    (item: BulkDownloadItem) =>
      resolveBulkEncryptionOptions(item, encryptionContext),
    [encryptionContext],
  );

  const startQueue = useCallback(async () => {
    if (!canStart) return;

    const abortController = new AbortController();
    abortRef.current = abortController;
    setIsRunning(true);
    setIsComplete(false);

    const runnableItems = items.filter(itemIsRunnable);
    for (const item of runnableItems) {
      if (abortController.signal.aborted) break;

      if (shouldSkipEncrypted(item, encryptionContext)) {
        updateItem(item.cid, (current) => ({
          ...current,
          status: 'skipped',
          skippedReason: 'Encrypted file skipped',
        }));
        continue;
      }

      // Defense-in-depth: even though `canStart` is gated by
      // `hasConfirmedInsecure`, refuse to download insecure files at the
      // runtime boundary so future changes to the UI gate can't bypass it.
      if (shouldSkipInsecure(item, hasConfirmedInsecure)) {
        updateItem(item.cid, (current) => ({
          ...current,
          status: 'skipped',
          skippedReason: 'Insecure file not confirmed',
        }));
        continue;
      }

      const { password, skipDecryption } = resolveEncryptionOptions(item);

      try {
        await runObjectDownloadFlow({
          api: network.api,
          downloadService: network.downloadService,
          metadata: item.information.metadata,
          password,
          skipDecryption,
          signal: abortController.signal,
          onAsyncDownloadsRefresh: updateAsyncDownloads,
          getAsyncDownloads: () =>
            useUserAsyncDownloadsStore.getState().asyncDownloads,
          onProgress: (progress) => {
            updateItem(item.cid, (current) => ({
              ...current,
              progress,
            }));
          },
          onPhaseChange: (phase) => {
            if (phase === 'preparing') {
              currentAsyncItemRef.current = {
                item,
                password,
                skipDecryption,
              };
            } else if (currentAsyncItemRef.current?.item.cid === item.cid) {
              currentAsyncItemRef.current = null;
            }

            updateItem(item.cid, (current) => ({
              ...current,
              status: phase,
              error: undefined,
            }));
          },
        });
        toast.success(`${shortenString(itemName(item), 30)} downloaded`, {
          id: `${toastId}-${item.cid}`,
        });
      } catch (error) {
        if (currentAsyncItemRef.current?.item.cid === item.cid) {
          currentAsyncItemRef.current = null;
        }

        if (error instanceof ObjectDownloadAbortedError) {
          break;
        }

        const errorMessage =
          error instanceof InvalidDecryptKey
            ? 'Wrong password'
            : error instanceof Error && error.message
              ? error.message
              : 'Download failed';
        updateItem(item.cid, (current) => ({
          ...current,
          status: 'failed',
          error: errorMessage,
        }));
        toast.error(`Failed to download ${shortenString(itemName(item), 30)}`, {
          id: `${toastId}-${item.cid}`,
        });
      }
    }

    currentAsyncItemRef.current = null;
    setIsRunning(false);
    setIsComplete(true);
  }, [
    canStart,
    encryptionContext,
    hasConfirmedInsecure,
    items,
    network.api,
    network.downloadService,
    resolveEncryptionOptions,
    updateAsyncDownloads,
    updateItem,
  ]);

  const retryFailed = useCallback(() => {
    setItems((current) =>
      current.map((item) =>
        item.status === 'failed' && item.information
          ? {
              ...item,
              status: 'pending',
              error: undefined,
              progress: null,
            }
          : item,
      ),
    );
    setIsComplete(false);
    setPendingRetryStart(true);
  }, []);

  useEffect(() => {
    if (pendingRetryStart && canStart) {
      setPendingRetryStart(false);
      startQueue();
    }
  }, [pendingRetryStart, canStart, startQueue]);

  const closeModal = useCallback(() => {
    // Only background remaining items when the queue was actually started.
    // Without this guard, clicking Cancel before Start Download would
    // spuriously kick off async downloads for every selected file.
    if (isRunning) {
      const remainingNotStarted = items
        .filter(
          (item): item is BulkDownloadItem & { information: ObjectInformation } =>
            (item.status === 'pending' || item.status === 'checking') &&
            !!item.information,
        )
        .filter(
          (item) =>
            !shouldSkipEncrypted(item, encryptionContext) &&
            !shouldSkipInsecure(item, hasConfirmedInsecure),
        );

      const currentAsync = currentAsyncItemRef.current;
      let backgroundedCount = 0;

      if (currentAsync?.item.information) {
        addPendingAutoDownload({
          cid: currentAsync.item.information.metadata.dataCid,
          password: currentAsync.skipDecryption
            ? undefined
            : currentAsync.password,
          skipDecryption: currentAsync.skipDecryption,
          fileName: currentAsync.item.information.metadata.name ?? undefined,
        });
        backgroundedCount += 1;
      }

      const backgroundPromises = remainingNotStarted.map((item) => {
        const { password: itemPassword, skipDecryption } =
          resolveBulkEncryptionOptions(item, encryptionContext);
        const cid = item.information.metadata.dataCid;
        const fileName = item.information.metadata.name ?? undefined;

        return network.api
          .createAsyncDownload(cid)
          .then(() => {
            addPendingAutoDownload({
              cid,
              password: skipDecryption ? undefined : itemPassword,
              skipDecryption,
              fileName,
            });
            return true as const;
          })
          .catch((err) => {
            console.warn(
              `[BulkObjectDownloadModal] failed to background ${cid}`,
              err,
            );
            return false as const;
          });
      });

      if (backgroundedCount > 0 || backgroundPromises.length > 0) {
        Promise.all(backgroundPromises).then((results) => {
          const totalCount =
            backgroundedCount + results.filter(Boolean).length;
          if (totalCount > 0) {
            updateAsyncDownloads();
            toast.success(
              `${totalCount} download${totalCount === 1 ? '' : 's'} will continue in the background. Check Cached Downloads for progress.`,
              { id: toastId, duration: 5000 },
            );
          }
        });
      }
    }

    abortRef.current?.abort();
    if (isComplete) {
      onComplete();
    }
    onClose();
  }, [
    addPendingAutoDownload,
    encryptionContext,
    hasConfirmedInsecure,
    isComplete,
    isRunning,
    items,
    network.api,
    onClose,
    onComplete,
    updateAsyncDownloads,
  ]);

  const handleDialogClose = useCallback(() => {
    // Backdrop / Esc close should not abort an in-flight queue — require the
    // user to explicitly hit Close while running to background what we can.
    if (isRunning) return;
    closeModal();
  }, [isRunning, closeModal]);

  const completedCount = items.filter(
    (item) => item.status === 'completed',
  ).length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as='div' className='relative z-10' onClose={handleDialogClose}>
        <TransitionChild
          as={Fragment}
          enter='ease-out duration-300'
          enterFrom='opacity-0'
          enterTo='opacity-100'
          leave='ease-in duration-200'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <div className='fixed inset-0 bg-background-hover bg-opacity-25' />
        </TransitionChild>

        <div className='fixed inset-0 overflow-y-auto'>
          <div className='flex min-h-full items-center justify-center p-4 text-center'>
            <TransitionChild
              as={Fragment}
              enter='ease-out duration-300'
              enterFrom='opacity-0 scale-95'
              enterTo='opacity-100 scale-100'
              leave='ease-in duration-200'
              leaveFrom='opacity-100 scale-100'
              leaveTo='opacity-0 scale-95'
            >
              <DialogPanel className='flex max-h-[80vh] w-full max-w-2xl transform flex-col gap-4 overflow-hidden rounded-2xl bg-background-hover p-6 text-left align-middle shadow-xl transition-all'>
                <div className='flex items-start justify-between gap-4'>
                  <div>
                    <DialogTitle className='text-lg font-medium'>
                      Download {cids.length} files
                    </DialogTitle>
                    <p
                      className='text-sm text-gray-500'
                      aria-live='polite'
                      aria-atomic='true'
                    >
                      {completedCount} completed, {failedCount} failed,{' '}
                      {skippedCount} skipped
                    </p>
                  </div>
                  {isLoadingMetadata && (
                    <div className='h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-primary' />
                  )}
                </div>

                {insecureItems.length > 0 && !hasConfirmedInsecure && (
                  <div className='rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-700'>
                    {insecureItems.length} selected file
                    {insecureItems.length === 1 ? ' is' : 's are'} marked
                    insecure.
                    <Button
                      variant='primary'
                      className='mt-3 w-full text-xs'
                      onClick={() => setHasConfirmedInsecure(true)}
                    >
                      Download Anyway
                    </Button>
                  </div>
                )}

                {encryptedItemsNeedingDecision.length > 0 &&
                  (insecureItems.length === 0 || hasConfirmedInsecure) && (
                    <div className='rounded-lg border border-gray-300 p-3 text-sm'>
                      <p className='mb-3 font-medium'>
                        {encryptedItemsNeedingDecision.length} encrypted file
                        {encryptedItemsNeedingDecision.length === 1
                          ? ''
                          : 's'}{' '}
                        need a bulk decision.
                      </p>
                      <div className='grid gap-2 sm:grid-cols-3'>
                        <Button
                          variant={
                            encryptionChoice === 'download-encrypted'
                              ? 'primary'
                              : 'secondary'
                          }
                          className='text-xs'
                          onClick={() =>
                            setEncryptionChoice('download-encrypted')
                          }
                        >
                          Download encrypted
                        </Button>
                        <Button
                          variant={
                            encryptionChoice === 'shared-password'
                              ? 'primary'
                              : 'secondary'
                          }
                          className='text-xs'
                          onClick={() => setEncryptionChoice('shared-password')}
                        >
                          Use one password
                        </Button>
                        <Button
                          variant={
                            encryptionChoice === 'skip'
                              ? 'primary'
                              : 'secondary'
                          }
                          className='text-xs'
                          onClick={() => setEncryptionChoice('skip')}
                        >
                          Skip encrypted
                        </Button>
                      </div>
                      {encryptionChoice === 'shared-password' && (
                        <input
                          type='password'
                          value={sharedPassword}
                          onChange={(event) =>
                            setSharedPassword(event.target.value)
                          }
                          className='mt-3 block w-full rounded-md border border-gray-300 bg-background p-2 text-foreground shadow-sm'
                          placeholder='Password'
                        />
                      )}
                    </div>
                  )}

                <div className='min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200'>
                  {items.map((item) => {
                    const progress = item.progress?.percentage ?? 0;
                    return (
                      <div
                        key={item.cid}
                        className='border-b border-gray-200 p-3 last:border-b-0'
                      >
                        <div className='flex items-center justify-between gap-3'>
                          <div className='min-w-0'>
                            <p className='truncate text-sm font-medium'>
                              {shortenString(itemName(item), 48)}
                            </p>
                            <p className='truncate text-xs text-gray-500'>
                              {item.cid}
                            </p>
                          </div>
                          <span className='shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700'>
                            {statusLabel[item.status]}
                          </span>
                        </div>
                        {item.status === 'downloading' && (
                          <div className='mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200'>
                            <div
                              className='h-full bg-primary transition-all duration-300'
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                        {item.progress?.downloadedBytes !== undefined &&
                          item.status === 'downloading' && (
                            <p className='mt-1 text-xs text-gray-500'>
                              {formatBytes(item.progress.downloadedBytes)} /{' '}
                              {formatBytes(
                                item.progress.totalBytes ??
                                  Number(
                                    item.information?.metadata.totalSize ?? 0,
                                  ),
                              )}
                            </p>
                          )}
                        {(item.error || item.skippedReason) && (
                          <p className='mt-1 text-xs text-red-500'>
                            {item.error ?? item.skippedReason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className='flex justify-end gap-2'>
                  <Button
                    variant='secondary'
                    className='text-xs'
                    onClick={closeModal}
                  >
                    {isRunning ? 'Close' : 'Cancel'}
                  </Button>
                  {isComplete && failedCount > 0 && !isRunning && (
                    <Button
                      variant='secondary'
                      className='text-xs'
                      onClick={retryFailed}
                    >
                      Retry failed ({failedCount})
                    </Button>
                  )}
                  <Button
                    variant='primary'
                    className='text-xs'
                    disabled={!canStart || isComplete}
                    onClick={startQueue}
                  >
                    {isRunning ? 'Downloading...' : 'Start Download'}
                  </Button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

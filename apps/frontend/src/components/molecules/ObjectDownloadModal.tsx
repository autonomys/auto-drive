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
import { OffchainMetadata } from '@autonomys/auto-dag-data';
import { InvalidDecryptKey } from 'utils/file';
import { Button } from '@auto-drive/ui';
import { shortenString } from 'utils/misc';
import { useEncryptionStore } from 'globalStates/encryption';
import toast from 'react-hot-toast';
import { useGetMetadataByHeadCidQuery } from 'gql/graphql';
import { mapObjectInformationFromQueryResult } from 'services/gql/utils';
import { useNetwork } from 'contexts/network';
import { DownloadProgressInfo } from 'services/download';
import { formatBytes } from 'utils/number';
import { useUserAsyncDownloadsStore } from '../organisms/UserAsyncDownloads/state';
import {
  ObjectDownloadAbortedError,
  ObjectDownloadPhase,
  runObjectDownloadFlow,
} from 'services/objectDownloadFlow';

const toastId = 'object-download-modal';

export const ObjectDownloadModal = ({
  cid,
  onClose,
}: {
  cid: string | null;
  onClose: () => void;
}) => {
  const [metadata, setMetadata] = useState<OffchainMetadata>();
  const [password, setPassword] = useState<string>();
  const [passwordConfirmed, setPasswordConfirmed] = useState<boolean>(false);
  const [skipDecryption, setSkipDecryption] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [wrongPassword, setWrongPassword] = useState<boolean>(false);
  const [insecure, setInsecure] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgressInfo | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState<boolean>(false);
  const [asyncPreparing, setAsyncPreparing] = useState<boolean>(false);
  const defaultPassword = useEncryptionStore((store) => store.password);
  const network = useNetwork();
  const updateAsyncDownloads = useUserAsyncDownloadsStore((e) => e.update);
  const addPendingAutoDownload = useUserAsyncDownloadsStore(
    (e) => e.addPendingAutoDownload,
  );

  const downloadInitiatedRef = useRef<string | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const downloadPhaseRef = useRef<ObjectDownloadPhase | null>(null);

  const handleCloseWhileAsyncPreparing = useCallback(() => {
    if (!asyncPreparing || !metadata) return;

    addPendingAutoDownload({
      cid: metadata.dataCid,
      password: skipDecryption ? undefined : password,
      skipDecryption,
      fileName: metadata.name ?? undefined,
    });

    toast.success(
      'Download continues in the background. Check Cached Downloads for progress.',
      { id: toastId, duration: 5000 },
    );
  }, [
    asyncPreparing,
    metadata,
    password,
    skipDecryption,
    addPendingAutoDownload,
  ]);

  useEffect(() => {
    if (!cid) {
      setMetadata(undefined);
      setPassword(undefined);
      setPasswordConfirmed(false);
      setSkipDecryption(false);
      setIsDownloading(false);
      setWrongPassword(false);
      setDownloadProgress(null);
      setDownloadError(null);
      setCheckingStatus(false);
      setAsyncPreparing(false);
      downloadInitiatedRef.current = null;
      downloadPhaseRef.current = null;
    }

    return () => {
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
    };
  }, [cid]);

  useGetMetadataByHeadCidQuery({
    variables: {
      headCid: cid ?? '',
    },
    skip: !cid,
    onCompleted: (data) => {
      const summary = mapObjectInformationFromQueryResult(data);
      setMetadata(summary.metadata);
      setInsecure(summary.tags.includes('insecure'));

      const dataCid = summary.metadata?.dataCid;
      if (dataCid && downloadInitiatedRef.current !== dataCid) {
        setPassword(undefined);
        setPasswordConfirmed(false);
        if (defaultPassword && !wrongPassword) {
          setPassword(defaultPassword);
          setPasswordConfirmed(true);
        }
      }
    },
    onError: (error) => {
      console.error('error', error);
    },
  });

  const onDownload = useCallback(async () => {
    if (!metadata) return;

    downloadAbortRef.current?.abort();
    const abortController = new AbortController();
    downloadAbortRef.current = abortController;

    setDownloadError(null);
    setDownloadProgress(null);
    downloadPhaseRef.current = null;

    try {
      await runObjectDownloadFlow({
        api: network.api,
        downloadService: network.downloadService,
        metadata,
        password,
        skipDecryption,
        signal: abortController.signal,
        onProgress: (progress) => {
          setDownloadProgress(progress);
        },
        onAsyncDownloadsRefresh: updateAsyncDownloads,
        getAsyncDownloads: () =>
          useUserAsyncDownloadsStore.getState().asyncDownloads,
        onPhaseChange: (phase) => {
          const previousPhase = downloadPhaseRef.current;
          downloadPhaseRef.current = phase;

          setCheckingStatus(phase === 'checking');
          setAsyncPreparing(phase === 'preparing');
          if (phase === 'downloading') {
            setIsDownloading(true);
          }

          if (phase === 'downloading' && previousPhase === 'preparing') {
            toast.success(
              `${shortenString(metadata.name ?? 'File', 30)} is ready — downloading now`,
              { id: toastId },
            );
          }
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      toast.success(
        skipDecryption ? 'Encrypted file downloaded' : 'Download completed',
        { id: toastId },
      );
      onClose();
    } catch (e) {
      if (e instanceof InvalidDecryptKey) {
        setPassword(undefined);
        setPasswordConfirmed(false);
        setSkipDecryption(false);
        setWrongPassword(true);
        setIsDownloading(false);
        downloadInitiatedRef.current = null;
      } else if (e instanceof ObjectDownloadAbortedError) {
        return;
      } else {
        console.error('Download failed:', e);
        const errorMessage =
          e instanceof Error && e.message
            ? e.message
            : 'Download failed. Please try again.';
        setDownloadError(errorMessage);
        toast.error(errorMessage, { id: toastId });
        setIsDownloading(false);
        setAsyncPreparing(false);
        setCheckingStatus(false);
      }
    }
  }, [
    metadata,
    password,
    skipDecryption,
    network.api,
    network.downloadService,
    updateAsyncDownloads,
    onClose,
  ]);

  const passwordOrNotEncrypted =
    (metadata && !metadata.uploadOptions?.encryption?.algorithm) ||
    passwordConfirmed;

  useEffect(() => {
    if (
      passwordOrNotEncrypted &&
      !isDownloading &&
      !checkingStatus &&
      !asyncPreparing &&
      !insecure &&
      metadata?.dataCid &&
      downloadInitiatedRef.current !== metadata.dataCid
    ) {
      downloadInitiatedRef.current = metadata.dataCid;
      onDownload();
    }
  }, [
    passwordOrNotEncrypted,
    onDownload,
    isDownloading,
    checkingStatus,
    asyncPreparing,
    insecure,
    metadata?.dataCid,
  ]);

  useEffect(() => {
    if (wrongPassword) {
      toast.dismiss(toastId);
    }
  }, [wrongPassword]);

  const progressView = useMemo(() => {
    if (!metadata) return null;

    const percentage = downloadProgress?.percentage ?? 0;
    const downloadedBytes = downloadProgress?.downloadedBytes ?? 0;
    const totalBytes =
      downloadProgress?.totalBytes ?? Number(metadata.totalSize);

    return (
      <div className='flex flex-col gap-4'>
        <DialogTitle className='text-lg font-medium'>
          Downloading {shortenString(metadata.name ?? 'file', 30)}
        </DialogTitle>

        <div className='w-full'>
          <div className='mb-2 flex justify-between text-sm text-gray-600'>
            <span>{formatBytes(downloadedBytes)}</span>
            <span>{formatBytes(totalBytes)}</span>
          </div>
          <div className='h-3 w-full overflow-hidden rounded-full bg-gray-200'>
            <div
              className='h-full rounded-full bg-primary transition-all duration-300 ease-out'
              style={{ width: `${percentage}%` }}
              role='progressbar'
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className='mt-2 text-center text-sm font-medium text-gray-700'>
            {percentage}%
          </div>
        </div>

        {downloadError && (
          <div className='mt-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600'>
            {downloadError}
            <Button
              variant='primary'
              className='mt-2 w-full text-xs'
              onClick={() => {
                setDownloadError(null);
                setIsDownloading(false);
                setDownloadProgress(null);
                downloadInitiatedRef.current = null;
              }}
            >
              Try Again
            </Button>
          </div>
        )}

        <p className='text-center text-xs text-gray-500'>
          Please keep this window open until the download completes
        </p>
      </div>
    );
  }, [metadata, downloadProgress, downloadError]);

  const view = useMemo(() => {
    if (!metadata) {
      return null;
    }

    if (checkingStatus) {
      return (
        <div className='flex items-center justify-center gap-3 py-4'>
          <div className='h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-primary' />
          <p className='text-sm text-gray-600'>Checking file availability…</p>
        </div>
      );
    }

    if (asyncPreparing) {
      return (
        <div className='flex flex-col gap-4'>
          <DialogTitle className='text-lg font-medium'>
            Preparing {shortenString(metadata.name ?? 'file', 30)}
          </DialogTitle>
          <div className='flex items-center gap-3'>
            <div className='h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-primary' />
            <p className='text-sm text-gray-600'>
              This file is being retrieved from the network. This may take
              several minutes — your download will start automatically when
              it&apos;s ready.
            </p>
          </div>
          <p className='text-center text-xs text-gray-500'>
            You can close this dialog and continue browsing. Your download will
            start automatically when it&apos;s ready.
          </p>
          <Button
            variant='secondary'
            className='w-full text-xs'
            onClick={() => {
              handleCloseWhileAsyncPreparing();
              onClose();
            }}
          >
            Close
          </Button>
        </div>
      );
    }

    if (isDownloading || downloadError) {
      return progressView;
    }

    if (insecure) {
      return (
        <div className='flex flex-col items-center gap-2'>
          <div className='flex flex-col items-center gap-2'>
            <span className='rounded-lg border bg-orange-500 p-2 text-center text-sm font-bold text-white'>
              Auto-Drive has detected this file as insecure, are you sure you
              want to download it?
            </span>
          </div>
          <div className='flex w-full justify-center gap-2'>
            <Button
              variant='primary'
              className='w-[50%] text-xs'
              onClick={() => setInsecure(false)}
            >
              Download Anyway
            </Button>
          </div>
        </div>
      );
    }

    if (passwordOrNotEncrypted) {
      return null;
    }

    if (metadata.type === 'file' && !passwordConfirmed) {
      return (
        <div>
          <div className='flex flex-col items-center gap-4'>
            <p className='text-sm text-gray-600'>
              This file is encrypted. You can either decrypt it with your
              password or download it as encrypted data.
            </p>

            <div className='flex w-full flex-col gap-2'>
              <label
                htmlFor='password'
                className='block text-sm font-medium text-gray-700'
              >
                Enter Decrypting Password
              </label>
              <input
                type='password'
                id='password'
                value={password ?? ''}
                onChange={(e) => setPassword(e.target.value)}
                className='block w-full rounded-md border border-gray-300 bg-background p-2 text-foreground shadow-sm'
                placeholder='Password'
              />
              <Button
                variant='primary'
                className='w-full text-xs'
                onClick={() => {
                  setSkipDecryption(false);
                  setPasswordConfirmed(true);
                }}
              >
                Download Decrypted
              </Button>
              {wrongPassword && (
                <div className='flex justify-center text-sm text-red-500'>
                  Wrong password
                </div>
              )}
            </div>

            <div className='flex w-full items-center gap-2'>
              <div className='h-px flex-1 bg-gray-300' />
              <span className='text-xs text-gray-500'>or</span>
              <div className='h-px flex-1 bg-gray-300' />
            </div>

            <Button
              variant='secondary'
              className='w-full text-xs'
              onClick={() => {
                setPassword(undefined);
                setSkipDecryption(true);
                setPasswordConfirmed(true);
              }}
            >
              Download Encrypted (No Decryption)
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-4'>
        <span className='text-sm text-gray-500'>
          Folder &quot;{shortenString(metadata.name ?? '', 20)}&quot; includes
          encrypted files. This will download a zip file with files
          encrypted.{' '}
        </span>
        <span className='text-sm font-bold text-gray-500'>
          For downloading the plain files, download individual files, providing
          their password.
        </span>
        <Button onClick={() => setPasswordConfirmed(true)}>Download ZIP</Button>
      </div>
    );
  }, [
    metadata,
    checkingStatus,
    isDownloading,
    downloadError,
    progressView,
    asyncPreparing,
    insecure,
    passwordOrNotEncrypted,
    passwordConfirmed,
    password,
    wrongPassword,
    onClose,
    handleCloseWhileAsyncPreparing,
  ]);

  // Show modal when there's a view to display OR when downloading/preparing
  const shouldShowModal =
    !!cid && (!!view || isDownloading || asyncPreparing || checkingStatus);

  if (!shouldShowModal) return <></>;

  return (
    <Transition appear show={shouldShowModal} as={Fragment}>
      <Dialog
        as='div'
        className='relative z-10'
        onClose={() => {
          if (asyncPreparing) {
            handleCloseWhileAsyncPreparing();
            onClose();
          } else if (!isDownloading) {
            onClose();
          }
        }}
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
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-background-hover p-6 text-left align-middle shadow-xl transition-all'>
                {view ?? progressView}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

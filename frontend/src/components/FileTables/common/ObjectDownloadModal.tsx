import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { OffchainMetadata } from '@autonomys/auto-dag-data';
import { InvalidDecryptKey } from 'utils/file';
import { Button } from 'components/common/Button';
import { shortenString } from 'utils/misc';
import { useEncryptionStore } from 'globalStates/encryption';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { useGetMetadataByHeadCidQuery } from 'gql/graphql';
import { mapObjectInformationFromQueryResult } from 'services/gql/utils';
import { useNetwork } from 'contexts/network';

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
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [wrongPassword, setWrongPassword] = useState<boolean>(false);
  const [insecure, setInsecure] = useState<boolean>(false);
  const defaultPassword = useEncryptionStore((store) => store.password);
  const session = useSession();
  const network = useNetwork();

  useEffect(() => {
    if (!cid) {
      setMetadata(undefined);
      setPassword(undefined);
      setPasswordConfirmed(false);
      setIsDownloading(false);
      setWrongPassword(false);
    }
  }, [cid]);

  useGetMetadataByHeadCidQuery({
    variables: {
      headCid: cid ?? '',
    },
    skip: !cid || !session.data?.accessToken,
    onCompleted: (data) => {
      const summary = mapObjectInformationFromQueryResult(data);
      setMetadata(summary.metadata);
      setPassword(undefined);
      setPasswordConfirmed(false);
      setIsDownloading(false);
      setInsecure(summary.tags.includes('insecure'));
      if (defaultPassword && !wrongPassword) {
        setPassword(defaultPassword);
        setPasswordConfirmed(true);
      }
    },
    onError: (error) => {
      console.error('error', error);
    },
  });

  const onDownload = useCallback(async () => {
    if (!metadata) return <DialogTitle>Fetching metadata...</DialogTitle>;
    const passwordToUse = password ?? undefined;

    try {
      await network.downloadService.fetchFile(metadata.dataCid, passwordToUse);
      await new Promise((resolve) => setTimeout(resolve, 250));
      toast.success('Download completed', {
        id: toastId,
      });
      onClose();
    } catch (e) {
      if (e instanceof InvalidDecryptKey) {
        setPassword(undefined);
        setPasswordConfirmed(false);
        setWrongPassword(true);
      }
    }
  }, [metadata, password, network.downloadService, onClose]);

  const passwordOrNotEncrypted =
    (metadata && !metadata.uploadOptions?.encryption?.algorithm) ||
    passwordConfirmed;

  useEffect(() => {
    if (passwordOrNotEncrypted && !isDownloading && !insecure) {
      setIsDownloading(true);
      onDownload();
    }
  }, [passwordOrNotEncrypted, onDownload, isDownloading, insecure]);

  useEffect(() => {
    if (wrongPassword) {
      toast.dismiss(toastId);
    }
  }, [wrongPassword]);

  const view = useMemo(() => {
    if (!metadata) {
      return null;
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
          <div className='flex flex-col items-center gap-2'>
            <label
              htmlFor='password'
              className='block text-sm font-medium text-gray-700'
            >
              Enter Decrypting Password
            </label>
            <input
              type='password'
              id='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className='mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm'
              placeholder='Password'
            />
            <Button
              variant='primary'
              className='w-[50%] text-xs'
              onClick={() => setPasswordConfirmed(true)}
            >
              Confirm Password
            </Button>
            {wrongPassword && (
              <div className='flex justify-center text-sm text-red-500'>
                Wrong password
              </div>
            )}
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
    passwordOrNotEncrypted,
    passwordConfirmed,
    password,
    wrongPassword,
  ]);

  useEffect(() => {
    if (isDownloading) {
      toast.loading('Downloading...', {
        id: toastId,
      });
    }
  }, [isDownloading]);

  if (!view) return <></>;

  return (
    <Transition appear show={!!cid} as={Fragment}>
      <Dialog as='div' className='relative z-10' onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter='ease-out duration-300'
          enterFrom='opacity-0'
          enterTo='opacity-100'
          leave='ease-in duration-200'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <div className='fixed inset-0 bg-black bg-opacity-25 dark:bg-darkBlack/25' />
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
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all dark:bg-darkWhite'>
                {view}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

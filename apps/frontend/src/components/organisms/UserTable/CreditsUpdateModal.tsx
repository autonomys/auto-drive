'use client';

import {
  Transition,
  Dialog,
  TransitionChild,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@auto-drive/ui';
import { useNetwork } from 'contexts/network';
import { SubscriptionGranularity } from '@auto-drive/models';

export const CreditsUpdateModal = ({
  userHandle,
  onClose,
}: {
  userHandle: string | null;
  onClose: () => void;
}) => {
  const [downloadCredits, setDownloadCredits] = useState<string>('');
  const [downloadCreditsUnit, setDownloadCreditsUnit] = useState<number>(
    1024 ** 2,
  );
  const [uploadCredits, setUploadCredits] = useState<string>('');
  const [uploadCreditsUnit, setUploadCreditsUnit] = useState<number>(1024 ** 2);
  const [granularity, setGranularity] = useState<SubscriptionGranularity>(
    SubscriptionGranularity.Monthly,
  );

  const network = useNetwork();

  useEffect(() => {
    setDownloadCredits('');
    setUploadCredits('');
    setDownloadCreditsUnit(1024 ** 2);
    setUploadCreditsUnit(1024 ** 2);
    setGranularity(SubscriptionGranularity.Monthly);
  }, [userHandle]);

  const updateCredits = useCallback(async () => {
    if (userHandle && downloadCredits && uploadCredits) {
      const downloadBytes = Number(downloadCredits) * downloadCreditsUnit;
      const uploadBytes = Number(uploadCredits) * uploadCreditsUnit;
      await network.api.updateSubscription(
        userHandle,
        granularity,
        uploadBytes,
        downloadBytes,
      );
      onClose();
      toast.success('Credits updated');
    }
  }, [
    network.api,
    userHandle,
    downloadCredits,
    downloadCreditsUnit,
    uploadCredits,
    uploadCreditsUnit,
    granularity,
    onClose,
  ]);

  const validCredits = useMemo(() => {
    return (
      downloadCredits &&
      !isNaN(Number(downloadCredits)) &&
      uploadCredits &&
      !isNaN(Number(uploadCredits))
    );
  }, [downloadCredits, uploadCredits]);

  return (
    <Transition appear show={!!userHandle} as={Fragment}>
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
          <div className='bg-background-hover fixed inset-0' />
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
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-background p-6 text-left align-middle shadow-xl transition-all'>
                <DialogTitle
                  as='h3'
                  className='text-lg font-medium leading-6 text-foreground'
                >
                  Update credits
                </DialogTitle>
                <div className='mt-2'>
                  <div className='space-y-4'>
                    <div className='flex items-center space-x-2'>
                      <label
                        htmlFor='granularity'
                        className='dark:text-darkBlack min-w-[110px] text-left text-black'
                      >
                        Granularity
                      </label>
                      <select
                        className='dark:bg-darkWhite dark:text-darkBlack dark:ring-darkWhiteHover w-full rounded border border-gray-300 bg-white px-2 py-1 text-black dark:ring-1'
                        id='granularity'
                        value={granularity}
                        onChange={(e) =>
                          setGranularity(
                            e.target.value as SubscriptionGranularity,
                          )
                        }
                      >
                        <option value={SubscriptionGranularity.Monthly}>
                          Monthly
                        </option>
                        <option value={SubscriptionGranularity.OneOff}>
                          One-off
                        </option>
                      </select>
                    </div>
                    <div className='flex items-center space-x-2'>
                      <input
                        type='text'
                        className='border-background-hover bg-background-hover text-foreground-hover w-full rounded border px-2 py-1'
                        placeholder='Download credits'
                        value={downloadCredits}
                        onChange={(e) => setDownloadCredits(e.target.value)}
                      />
                      <select
                        className='border-background-hover bg-background-hover text-foreground-hover rounded border px-2 py-1'
                        value={downloadCreditsUnit}
                        onChange={(e) =>
                          setDownloadCreditsUnit(Number(e.target.value))
                        }
                      >
                        <option value={1024 ** 2}>MB</option>
                        <option value={1024 ** 3}>GB</option>
                        <option value={1024 ** 4}>TB</option>
                      </select>
                    </div>
                    <div className='flex items-center space-x-2'>
                      <input
                        type='text'
                        className='border-background-hover bg-background-hover text-foreground-hover w-full rounded border px-2 py-1'
                        placeholder='Upload credits'
                        value={uploadCredits}
                        onChange={(e) => setUploadCredits(e.target.value)}
                      />
                      <select
                        className='border-background-hover bg-background-hover text-foreground-hover rounded border px-2 py-1'
                        value={uploadCreditsUnit}
                        onChange={(e) =>
                          setUploadCreditsUnit(Number(e.target.value))
                        }
                      >
                        <option value={1024 ** 2}>MB</option>
                        <option value={1024 ** 3}>GB</option>
                        <option value={1024 ** 4}>TB</option>
                      </select>
                    </div>
                    <div className='flex justify-end'>
                      <Button
                        variant='lightAccent'
                        className='inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                        onClick={updateCredits}
                        disabled={!validCredits}
                      >
                        Update
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

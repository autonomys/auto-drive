import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  MyUndismissedAsyncDownloadsDocument,
  MyUndismissedAsyncDownloadsQuery,
} from '../../../gql/graphql';
import { useNetwork } from '../../contexts/network';
import { useUserAsyncDownloadsStore } from './state';
import { AsyncDownload } from '@auto-drive/models';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { AsyncDownloadRow } from './AsyncDownloadRow';
import { Button } from '../common/Button';
import { cn } from '@/utils/cn';
import { Download } from 'lucide-react';

export const UserAsyncDownloads = () => {
  const setFetcher = useUserAsyncDownloadsStore((e) => e.setFetcher);
  const asyncDownloads = useUserAsyncDownloadsStore((e) => e.asyncDownloads);
  const { gql } = useNetwork();
  const [isOpen, setIsOpen] = useState(false);

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

  const toggleModal = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  if (asyncDownloads.length === 0) {
    return null;
  }

  return (
    <div className='relative'>
      <Button
        variant='lightAccent'
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
              <DialogPanel className='inline-block flex h-[60vh] w-full max-w-md transform flex-col justify-between overflow-y-scroll rounded-2xl bg-backgroundLight bg-white p-6 text-left align-middle shadow-xl transition-all dark:bg-darkWhiteHover'>
                <div>
                  <DialogTitle
                    as='h3'
                    className='text-lg font-medium leading-6 text-gray-900 dark:text-white'
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
                    className='w-full justify-center text-sm font-medium'
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

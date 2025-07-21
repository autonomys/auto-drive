import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  FilesToBeReviewedDocument,
  FilesToBeReviewedQuery,
} from '../../../gql/graphql';
import { useNetwork } from '../../contexts/network';
import { useFilesToBeReviewedStore } from './state';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Button } from '../common/Button';
import { cn } from '@/utils/cn';
import { AlertTriangle } from 'lucide-react';
import { ToBeReviewedFileRow } from './ReviewFilesRow';
import { useUserStore } from '../../globalStates/user';
import { isAdminUser, ObjectTag } from '@auto-drive/models';

export const ToBeReviewedFiles = () => {
  const setFetcher = useFilesToBeReviewedStore((e) => e.setFetcher);
  const toBeReviewedFileCIDs = useFilesToBeReviewedStore(
    (e) => e.asyncDownloads,
  );
  const { gql } = useNetwork();
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useUserStore();

  const fetcher = useCallback(async (): Promise<string[]> => {
    const { data } = await gql.query<FilesToBeReviewedQuery>({
      query: FilesToBeReviewedDocument,
      fetchPolicy: 'network-only',
      variables: {
        includingTags: [ObjectTag.ToBeReviewed],
        excludingTags: [ObjectTag.Banned, ObjectTag.ReportDismissed],
        limit: 100,
        offset: 0,
      },
    });

    return data.metadata_roots.map((root) => root.headCid!) ?? [];
  }, [gql]);

  useEffect(() => {
    setFetcher(fetcher);
  }, [fetcher, setFetcher]);

  const toggleModal = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  if (toBeReviewedFileCIDs.length === 0 || !user || !isAdminUser(user)) {
    return null;
  }

  return (
    <div className='relative'>
      <Button
        variant='danger'
        className={cn(
          'flex items-center gap-1 text-sm',
          toBeReviewedFileCIDs.length > 0 && 'font-medium',
        )}
        onClick={toggleModal}
      >
        <AlertTriangle className='h-4 w-4' />
        Files to be reviewed ({toBeReviewedFileCIDs.length})
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
            <div className='fixed inset-0 bg-black/25 dark:bg-darkBlack/25' />
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
              <DialogPanel className='inline-block flex h-[60vh] w-full max-w-md transform flex-col justify-between overflow-y-scroll rounded-2xl bg-backgroundLight bg-white p-6 text-left align-middle shadow-xl transition-all dark:bg-darkWhiteHover'>
                <div>
                  <DialogTitle
                    as='h3'
                    className='text-lg font-medium leading-6 text-gray-900 dark:text-white'
                  >
                    Files to be reviewed
                  </DialogTitle>
                  <div className='mt-4 flex flex-col gap-2'>
                    {toBeReviewedFileCIDs.map((headCid) => (
                      <ToBeReviewedFileRow key={headCid} headCid={headCid} />
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

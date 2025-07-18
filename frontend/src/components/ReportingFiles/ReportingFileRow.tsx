import { useCallback, useState, Fragment } from 'react';
import { BanIcon, CopyIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useReportingFilesStore } from './state';
import { useNetwork } from '../../contexts/network';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Button } from 'components/common/Button';

export const ReportingFileRow = ({ headCid }: { headCid: string }) => {
  const updateReportingFiles = useReportingFilesStore((e) => e.update);
  const { api } = useNetwork();
  const [isBanModalOpen, setIsBanModalOpen] = useState(false);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(headCid);
    toast.success('Copied to clipboard');
  }, [headCid]);

  const openBanModal = useCallback(() => {
    setIsBanModalOpen(true);
  }, []);

  const closeBanModal = useCallback(() => {
    setIsBanModalOpen(false);
  }, []);

  const banFile = useCallback(() => {
    const toastId = toast.loading('Banning...');
    api
      .banFile(headCid)
      .then(() => {
        toast.success('Banned', { id: toastId });
        updateReportingFiles();
        closeBanModal();
      })
      .catch(() => {
        toast.error('Failed to ban', { id: toastId });
      });
  }, [headCid, updateReportingFiles, api, closeBanModal]);

  return (
    <>
      <div className='flex items-center gap-2 border-b border-gray-200 p-2 dark:border-gray-600'>
        <span className='flex-1 truncate font-mono text-sm'>{headCid}</span>
        <button
          onClick={copyToClipboard}
          className='rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700'
          title='Copy to clipboard'
        >
          <CopyIcon size={16} />
        </button>
        <button
          onClick={openBanModal}
          className='rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700'
          title='Ban'
        >
          <BanIcon className='h-4 w-4' />
        </button>
      </div>

      <Transition appear show={isBanModalOpen} as={Fragment}>
        <Dialog as='div' className='relative z-10' onClose={closeBanModal}>
          <TransitionChild
            as={Fragment}
            enter='ease-out duration-300'
            enterFrom='opacity-0'
            enterTo='opacity-100'
            leave='ease-in duration-200'
            leaveFrom='opacity-100'
            leaveTo='opacity-0'
          >
            <div className='fixed inset-0 bg-black dark:bg-darkBlack/25' />
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
                  <DialogTitle
                    as='h3'
                    className='text-lg font-medium leading-6 text-gray-900 dark:text-gray-100'
                  >
                    Ban File
                  </DialogTitle>
                  <div className='mt-2'>
                    <p className='text-sm text-gray-500 dark:text-gray-400'>
                      Are you sure you want to ban this file? This action will
                      mark the file as banned and remove it from reports.
                    </p>
                    <p className='mt-2 break-all font-mono text-sm text-gray-600 dark:text-gray-300'>
                      {headCid}
                    </p>
                  </div>
                  <div className='mt-6 flex justify-end gap-3'>
                    <Button variant='outline' onClick={closeBanModal}>
                      Cancel
                    </Button>
                    <Button variant='danger' onClick={banFile}>
                      Ban File
                    </Button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
};

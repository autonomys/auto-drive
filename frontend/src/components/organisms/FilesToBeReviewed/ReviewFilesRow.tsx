import { useCallback, useState, Fragment } from 'react';
import { BanIcon, CopyIcon, XCircleIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useFilesToBeReviewedStore } from './state';
import { useNetwork } from '../../../contexts/network';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Button } from '@/components/atoms/Button';

const TooltipButton = ({
  onClick,
  title,
  children,
  className,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className='group relative'>
      <button onClick={onClick} className={className} title={title}>
        {children}
      </button>
      <div className='w-fit-content invisible absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-800 p-2 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:visible group-hover:opacity-100 dark:bg-gray-700'>
        <div className='font-semibold'>{title}</div>
        <div className='absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-800 dark:border-t-gray-700'></div>
      </div>
    </div>
  );
};

export const ToBeReviewedFileRow = ({ headCid }: { headCid: string }) => {
  const updateFiles = useFilesToBeReviewedStore((e) => e.update);
  const { api } = useNetwork();
  const [isBanModalOpen, setIsBanModalOpen] = useState(false);
  const [isDismissModalOpen, setIsDismissModalOpen] = useState(false);

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

  const openDismissModal = useCallback(() => {
    setIsDismissModalOpen(true);
  }, []);

  const closeDismissModal = useCallback(() => {
    setIsDismissModalOpen(false);
  }, []);

  const banFile = useCallback(() => {
    const toastId = toast.loading('Banning...');
    api
      .banFile(headCid)
      .then(() => {
        toast.success('Banned', { id: toastId });
        updateFiles();
        closeBanModal();
      })
      .catch(() => {
        toast.error('Failed to ban', { id: toastId });
      });
  }, [headCid, updateFiles, api, closeBanModal]);

  const dismissReport = useCallback(() => {
    const toastId = toast.loading('Dismissing report...');
    api
      .dismissReport(headCid)
      .then(() => {
        toast.success('Report dismissed', { id: toastId });
        updateFiles();
        closeDismissModal();
      })
      .catch(() => {
        toast.error('Failed to dismiss report', { id: toastId });
      });
  }, [headCid, updateFiles, api, closeDismissModal]);

  return (
    <>
      <div className='flex items-center gap-2 border-b border-gray-200 p-2 dark:border-gray-600'>
        <span className='flex-1 truncate font-mono text-sm'>{headCid}</span>
        <TooltipButton
          onClick={copyToClipboard}
          title='Copy to Clipboard'
          className='rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700'
        >
          <CopyIcon size={16} />
        </TooltipButton>
        <TooltipButton
          onClick={openDismissModal}
          title='Dismiss Report'
          className='rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700'
        >
          <XCircleIcon className='h-4 w-4' />
        </TooltipButton>
        <TooltipButton
          onClick={openBanModal}
          title='Ban File'
          className='rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700'
        >
          <BanIcon className='h-4 w-4' />
        </TooltipButton>
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
                      mark the file as banned.
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

      <Transition appear show={isDismissModalOpen} as={Fragment}>
        <Dialog as='div' className='relative z-10' onClose={closeDismissModal}>
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
                    Dismiss Report
                  </DialogTitle>
                  <div className='mt-2'>
                    <p className='text-sm text-gray-500 dark:text-gray-400'>
                      Are you sure you want to dismiss this report? This action
                      will remove the file from the reporting queue.
                    </p>
                    <p className='mt-2 break-all font-mono text-sm text-gray-600 dark:text-gray-300'>
                      {headCid}
                    </p>
                  </div>
                  <div className='mt-6 flex justify-end gap-3'>
                    <Button variant='outline' onClick={closeDismissModal}>
                      Cancel
                    </Button>
                    <Button variant='lightAccent' onClick={dismissReport}>
                      Dismiss Report
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

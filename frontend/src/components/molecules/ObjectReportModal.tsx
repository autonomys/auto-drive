import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/atoms/Button';
import { useNetwork } from 'contexts/network';

export const ObjectReportModal = ({
  cid,
  closeModal,
}: {
  cid: string | null;
  closeModal: () => void;
}) => {
  const network = useNetwork();

  const onReportObject = useCallback(() => {
    if (!cid) {
      return;
    }

    const toastId = toast.loading('Reporting file...');
    network.api
      .reportFile(cid)
      .then(() => {
        toast.success('File reported successfully', { id: toastId });
        closeModal();
      })
      .catch(() => {
        toast.error('Failed to report file', { id: toastId });
      });
  }, [cid, network.api, closeModal]);

  return (
    <Transition appear show={cid !== null} as={Fragment}>
      <Dialog as='div' className='relative z-10' onClose={closeModal}>
        <TransitionChild
          as={Fragment}
          enter='ease-out duration-300'
          enterFrom='opacity-0'
          enterTo='opacity-100'
          leave='ease-in duration-200'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <div className='fixed inset-0 bg-black bg-opacity-25 dark:bg-darkBlack' />
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
                  className='text-center text-lg font-medium leading-6 text-gray-900 dark:text-gray-100'
                >
                  Report File
                </DialogTitle>
                <div className='mt-2'>
                  <p className='text-center text-sm text-gray-500 dark:text-gray-400'>
                    Are you sure you want to report this file? This will flag it
                    for review by administrators.
                  </p>
                  <p className='mt-2 break-all text-center font-mono text-xs text-gray-600 dark:text-gray-300'>
                    {cid}
                  </p>
                </div>

                <div className='mt-4 flex justify-center space-x-2'>
                  <Button
                    variant='outline'
                    className='text-sm'
                    onClick={closeModal}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant='lightDanger'
                    className='text-sm'
                    onClick={onReportObject}
                  >
                    Report File
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

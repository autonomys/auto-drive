import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../common/Button';
import { AuthService } from '../../services/auth/auth';

export const DeleteApiKeyModal = ({
  apiKeyId,
  closeModal,
}: {
  apiKeyId: string | null;
  closeModal: () => void;
}) => {
  const isOpen = apiKeyId !== null;

  const deleteApiKey = useCallback(() => {
    if (!apiKeyId) {
      return;
    }

    AuthService.deleteApiKey(apiKeyId)
      .then(() => {
        toast.success('API key deleted successfully');
        closeModal();
      })
      .catch(() => {
        toast.error('Failed to delete API key');
      });
  }, [apiKeyId, closeModal]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
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
          <div className='dark:bg-darkBlack/25 fixed inset-0 bg-black dark:bg-backgroundDarkest' />
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
              <DialogPanel className='dark:bg-darkWhite w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left text-center align-middle shadow-xl transition-all'>
                <DialogTitle
                  as='h3'
                  className='text-lg font-medium leading-6 text-gray-900 dark:text-white'
                >
                  Delete API Key
                </DialogTitle>
                <div className='mt-2'>
                  <p className='text-center text-sm text-gray-500 dark:text-white'>
                    Do you want to delete this API key?
                    <br />
                    <strong>This action cannot be undone.</strong>
                  </p>
                </div>
                <div className='mt-4 flex justify-center'>
                  <Button
                    variant='danger'
                    className='text-sm'
                    onClick={deleteApiKey}
                  >
                    Delete
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

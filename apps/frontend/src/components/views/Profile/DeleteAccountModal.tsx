'use client';

import { Fragment, useCallback, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Button } from '@auto-drive/ui';
import toast from 'react-hot-toast';
import { AuthService } from 'services/auth/auth';
import { useDeletionStore } from 'globalStates/deletion';

type DeleteAccountModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
};

export const DeleteAccountModal = ({
  isOpen,
  onClose,
  onDeleted,
}: DeleteAccountModalProps) => {
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setDeletionRequest = useDeletionStore(
    (state) => state.setDeletionRequest,
  );

  const isConfirmed = confirmText === 'DELETE';

  const handleSubmit = useCallback(async () => {
    if (!isConfirmed || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const request = await AuthService.requestDeletion(reason || undefined);
      toast.success('Account deletion requested. You have 30 days to cancel.');
      setDeletionRequest(request);
      onDeleted();
      onClose();
    } catch (error) {
      toast.error('Failed to request account deletion');
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  }, [isConfirmed, isSubmitting, reason, setDeletionRequest, onDeleted, onClose]);

  const handleClose = useCallback(() => {
    setConfirmText('');
    setReason('');
    onClose();
  }, [onClose]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as='div' className='relative z-50' onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter='ease-out duration-300'
          enterFrom='opacity-0'
          enterTo='opacity-100'
          leave='ease-in duration-200'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <div className='fixed inset-0 bg-black/40' />
        </Transition.Child>

        <div className='fixed inset-0 overflow-y-auto'>
          <div className='flex min-h-full items-center justify-center p-4'>
            <Transition.Child
              as={Fragment}
              enter='ease-out duration-300'
              enterFrom='opacity-0 scale-95'
              enterTo='opacity-100 scale-100'
              leave='ease-in duration-200'
              leaveFrom='opacity-100 scale-100'
              leaveTo='opacity-0 scale-95'
            >
              <Dialog.Panel className='w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800'>
                <Dialog.Title className='text-lg font-semibold text-red-600 dark:text-red-400'>
                  Delete Account
                </Dialog.Title>

                <div className='mt-4 space-y-4'>
                  <div className='rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300'>
                    <p className='font-medium'>This action will:</p>
                    <ul className='mt-1 list-inside list-disc space-y-1'>
                      <li>
                        Start a 30-day grace period before your data is
                        anonymised
                      </li>
                      <li>Expire any unused purchased credits</li>
                      <li>Remove your personal information from our systems</li>
                      <li>
                        Data stored on the DSN cannot be removed and will persist
                      </li>
                    </ul>
                  </div>

                  <div className='rounded-md bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'>
                    You can cancel this request within 30 days from your
                    profile or via the banner at the top of the page.
                  </div>

                  <div>
                    <label
                      htmlFor='deletion-reason'
                      className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                    >
                      Reason (optional)
                    </label>
                    <textarea
                      id='deletion-reason'
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className='mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white'
                      rows={2}
                      placeholder='Help us improve by sharing why you are leaving...'
                    />
                  </div>

                  <div>
                    <label
                      htmlFor='deletion-confirm'
                      className='block text-sm font-medium text-gray-700 dark:text-gray-300'
                    >
                      Type <span className='font-mono font-bold'>DELETE</span>{' '}
                      to confirm
                    </label>
                    <input
                      id='deletion-confirm'
                      type='text'
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      className='mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white'
                      placeholder='DELETE'
                    />
                  </div>
                </div>

                <div className='mt-6 flex justify-end gap-3'>
                  <Button variant='lightAccent' onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    variant='lightDanger'
                    onClick={handleSubmit}
                    disabled={!isConfirmed || isSubmitting}
                  >
                    {isSubmitting ? 'Requesting...' : 'Delete My Account'}
                  </Button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

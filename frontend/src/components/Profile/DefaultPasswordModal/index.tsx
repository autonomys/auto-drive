import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from 'components/common/Button';
import { useEncryptionStore } from 'globalStates/encryption';

export const DefaultPasswordModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const setDefaultPassword = useEncryptionStore((store) => store.setPassword);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');

  useEffect(() => {
    setNewPassword('');
    setConfirmPassword('');
  }, [isOpen]);

  const updatePassword = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    try {
      toast.success('Password updated successfully');
      onClose();
      setDefaultPassword(newPassword);
    } catch {
      toast.error('Failed to update password');
    }
  }, [newPassword, confirmPassword, onClose, setDefaultPassword]);

  const isDisabled =
    !newPassword || !confirmPassword || newPassword !== confirmPassword;

  return (
    <Transition appear show={isOpen} as={Fragment}>
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
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-background p-6 text-left align-middle shadow-xl transition-all bg-background'>
                <DialogTitle
                  as='h3'
                  className='text-lg font-medium leading-6 text-gray-900 dark:text-gray-100'
                >
                  Update Default Password
                </DialogTitle>
                <div className='mt-2'>
                  <p className='text-sm text-gray-500 dark:text-gray-400'>
                    Enter your new password.
                  </p>
                </div>
                <input
                  type='password'
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder='New Password'
                  className='mt-2 block w-full rounded-md border border-gray-300 p-2 shadow-sm dark:border-gray-600 bg-background dark:text-gray-100'
                />
                <input
                  type='password'
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder='Confirm Password'
                  className='mt-2 block w-full rounded-md border border-gray-300 p-2 shadow-sm dark:border-gray-600 bg-background dark:text-gray-100'
                />
                <div className='mt-4 flex justify-center gap-2'>
                  <Button
                    disabled={isDisabled}
                    variant='primary'
                    className='text-xs'
                    onClick={updatePassword}
                  >
                    Update Password
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

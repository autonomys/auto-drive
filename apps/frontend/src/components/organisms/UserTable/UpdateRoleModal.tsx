'use client';

import {
  Transition,
  Dialog,
  TransitionChild,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { Fragment, useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { UserRole } from '@auto-drive/models';
import { Button } from '@auto-drive/ui';
import { AuthService } from 'services/auth/auth';

export const UpdateRoleModal = ({
  userHandle,
  onClose,
}: {
  userHandle: string | null;
  onClose: () => void;
}) => {
  const [role, setRole] = useState<UserRole>(UserRole.User);

  const updateRole = useCallback(async () => {
    if (userHandle) {
      if (role === UserRole.Admin) {
        await AuthService.addAdmin(userHandle);
      } else {
        await AuthService.removeAdmin(userHandle);
      }
      onClose();
      toast.success('Role updated');
    }
  }, [userHandle, role, onClose]);

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
          <div className='dark:bg-darkBlack/25 fixed inset-0 bg-black' />
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
              <DialogPanel className='flex w-full max-w-md transform flex-col justify-center overflow-hidden rounded-2xl bg-background p-6 text-left align-middle text-foreground shadow-xl transition-all'>
                <DialogTitle
                  as='h3'
                  className='gap-4 text-center text-lg font-medium leading-6'
                >
                  Update user role
                </DialogTitle>
                <div className='mt-2'>
                  <div className='flex flex-col items-center space-y-4'>
                    <div className='flex flex-col items-center space-x-2'>
                      <select
                        className='border-background-hover bg-background-hover text-foreground-hover rounded border px-2 py-1'
                        value={role}
                        onChange={(e) => setRole(e.target.value as UserRole)}
                      >
                        <option value={UserRole.User}>
                          User (Manage own files)
                        </option>
                        <option value={UserRole.Admin}>
                          Admin (Manage user&apos;s account)
                        </option>
                      </select>
                    </div>
                    <div className='flex justify-center'>
                      <Button
                        variant='lightAccent'
                        className='bg-background-hover text-foreground-hover inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'
                        onClick={updateRole}
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

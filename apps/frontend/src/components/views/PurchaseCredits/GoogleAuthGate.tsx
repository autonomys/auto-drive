'use client';

import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment } from 'react';
import { Button } from '@auto-drive/ui';
import { useLogIn } from '../../../hooks/useAuth';

interface GoogleAuthGateProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Where to return after Google OAuth completes. Pass the purchase route so
   * the user resumes the buy-credits flow instead of being dropped on the
   * default drive view.
   */
  callbackUrl?: string;
}

/**
 * Shown when a logged-out or non-Google user tries to select a package on the
 * purchase screen. Purchasing storage credits requires a Google-verified
 * account (enforced server-side on intent creation), so we surface a clear
 * sign-in / sign-up prompt rather than letting them proceed into a flow that
 * would ultimately be rejected.
 */
export const GoogleAuthGate = ({
  isOpen,
  onClose,
  callbackUrl,
}: GoogleAuthGateProps) => {
  const { signIn } = useLogIn();

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
          <div className='bg-background-hover fixed inset-0 bg-opacity-25' />
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
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-background p-6 text-left align-middle text-foreground shadow-xl transition-all'>
                <div className='space-y-2'>
                  <DialogTitle className='text-center text-2xl font-bold'>
                    Sign in to buy credits
                  </DialogTitle>
                  <div className='text-center text-muted-foreground'>
                    Purchasing storage credits requires a Google account. Please
                    sign in or sign up with Google to continue.
                  </div>
                </div>

                <div className='space-y-3 py-4'>
                  <Button
                    variant='primary'
                    className='h-12 w-full justify-center space-x-3 font-semibold'
                    onClick={() => signIn('google', { callbackUrl })}
                  >
                    <svg className='h-5 w-5' viewBox='0 0 24 24'>
                      <path
                        fill='currentColor'
                        d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
                      />
                      <path
                        fill='currentColor'
                        d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
                      />
                      <path
                        fill='currentColor'
                        d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
                      />
                      <path
                        fill='currentColor'
                        d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
                      />
                    </svg>
                    <span>Sign in with Google</span>
                  </Button>

                  <Button
                    variant='outline'
                    className='w-full'
                    onClick={onClose}
                  >
                    Cancel
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

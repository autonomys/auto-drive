'use client';

import {
  Transition,
  Dialog,
  TransitionChild,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { CreatedApiKey } from '@auto-drive/models';
import toast from 'react-hot-toast';
import { Button } from '@auto-drive/ui';
import { handleEnterOrSpace } from 'utils/eventHandler';
import { AuthService } from 'services/auth/auth';

export const RotateApiKeyModal = ({
  apiKeyId,
  apiKeyName,
  closeModal,
  onRotated,
}: {
  apiKeyId: string | null;
  apiKeyName: string | null;
  closeModal: () => void;
  onRotated: () => void;
}) => {
  const isOpen = apiKeyId !== null;
  const [submitting, setSubmitting] = useState(false);
  const [rotated, setRotated] = useState<CreatedApiKey | null>(null);
  const [hasBeenCopied, setHasBeenCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRotated(null);
      setHasBeenCopied(false);
      setSubmitting(false);
    }
  }, [isOpen]);

  const rotate = useCallback(() => {
    if (!apiKeyId) return;
    setSubmitting(true);
    AuthService.rotateApiKey(apiKeyId)
      .then((key) => setRotated(key))
      .catch(() => toast.error('Failed to rotate API key'))
      .finally(() => setSubmitting(false));
  }, [apiKeyId]);

  const copy = useCallback(() => {
    if (rotated) {
      navigator.clipboard.writeText(rotated.secret);
      toast.success('Copied to clipboard');
      setHasBeenCopied(true);
    }
  }, [rotated]);

  const done = useCallback(() => {
    onRotated();
    closeModal();
  }, [closeModal, onRotated]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as='div'
        className='relative z-10'
        onClose={rotated && hasBeenCopied ? done : closeModal}
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
              <DialogPanel className='bg-background-hover w-full max-w-md transform overflow-hidden rounded-2xl bg-background p-6 text-left align-middle shadow-xl transition-all'>
                <DialogTitle
                  as='h3'
                  className='text-center text-lg font-medium leading-6 text-foreground'
                >
                  Rotate API Key
                </DialogTitle>
                <div className='mt-4'>
                  {rotated ? (
                    <div>
                      <p className='text-foreground-hover mb-3 text-center text-sm'>
                        Rotated <strong>{rotated.name}</strong>. Copy the new
                        key — the old one no longer works, and this value
                        won&apos;t be shown again.
                      </p>
                      <div className='flex items-center justify-center space-x-2'>
                        <button
                          tabIndex={0}
                          onKeyDown={handleEnterOrSpace(copy)}
                          className='bg-background-hover flex cursor-pointer items-center break-all rounded px-2 py-1 text-left font-mono text-xs'
                          onClick={copy}
                          title='Click to copy'
                        >
                          {rotated.secret}
                        </button>
                      </div>
                      <div className='mt-4 flex w-full items-center justify-center space-x-2'>
                        <Button variant='lightAccent' onClick={copy}>
                          {hasBeenCopied ? 'Copied!' : 'Copy'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Fragment>
                      <p className='text-foreground-hover text-center text-sm'>
                        Rotating <strong>{apiKeyName ?? 'this key'}</strong>{' '}
                        will immediately invalidate the current secret and
                        issue a new one.
                        <br />
                        <br />
                        <strong>
                          Any integrations using the old secret will stop
                          working until you update them.
                        </strong>
                      </p>
                      <div className='mt-4 flex justify-center'>
                        <Button
                          variant='lightAccent'
                          className='text-sm'
                          disabled={submitting}
                          onClick={rotate}
                        >
                          {submitting ? 'Rotating…' : 'Rotate key'}
                        </Button>
                      </div>
                    </Fragment>
                  )}
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

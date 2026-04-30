'use client';

import {
  Transition,
  Dialog,
  TransitionChild,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { APIKey } from '@auto-drive/models';
import toast from 'react-hot-toast';
import { Button } from '@auto-drive/ui';
import { handleEnterOrSpace } from 'utils/eventHandler';
import { AuthService } from 'services/auth/auth';

type ExpiryPreset = '30d' | '60d' | '90d' | '1y' | 'custom' | 'never';

const presetToIso = (preset: ExpiryPreset, custom: string): string | null => {
  const now = new Date();
  switch (preset) {
    case 'never':
      return null;
    case '30d':
      now.setDate(now.getDate() + 30);
      return now.toISOString();
    case '60d':
      now.setDate(now.getDate() + 60);
      return now.toISOString();
    case '90d':
      now.setDate(now.getDate() + 90);
      return now.toISOString();
    case '1y':
      now.setFullYear(now.getFullYear() + 1);
      return now.toISOString();
    case 'custom': {
      if (!custom) {
        throw new Error('Please select an expiry date');
      }
      const d = new Date(`${custom}T23:59:59`);
      if (Number.isNaN(d.getTime())) {
        throw new Error('Invalid expiry date');
      }
      if (d.getTime() <= Date.now()) {
        throw new Error('Expiry date must be in the future');
      }
      return d.toISOString();
    }
  }
};

const todayPlus = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const APIKeyCreationModal = ({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) => {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<ExpiryPreset>('never');
  const [customDate, setCustomDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [apiKey, setApiKey] = useState<APIKey | null>(null);
  const [hasBeenCopied, setHasBeenCopied] = useState(false);

  const epochRef = useRef(0);
  const [minDate, setMinDate] = useState(() => todayPlus(1));

  const reset = useCallback(() => {
    epochRef.current += 1;
    setName('');
    setPreset('never');
    setCustomDate('');
    setApiKey(null);
    setHasBeenCopied(false);
    setSubmitting(false);
    setMinDate(todayPlus(1));
  }, []);

  useEffect(() => {
    reset();
  }, [isOpen, reset]);

  const canSubmit = !submitting &&
    (preset !== 'custom' || customDate.length > 0);

  const createApiKey = useCallback(() => {
    if (!canSubmit) return;

    let expiresAt: string | null;
    try {
      expiresAt = presetToIso(preset, customDate);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid expiry date');
      return;
    }

    setSubmitting(true);
    const trimmed = name.trim();
    const epoch = epochRef.current;
    AuthService.generateAPIKey({
      name: trimmed.length === 0 ? null : trimmed,
      expiresAt,
    })
      .then((key) => {
        if (epochRef.current === epoch) setApiKey(key);
      })
      .catch((err: Error) => {
        if (epochRef.current === epoch) {
          toast.error(err.message || 'Failed to create API key');
          setSubmitting(false);
        }
      });
  }, [canSubmit, name, preset, customDate]);

  const copyToClipboard = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }, []);

  const copyApiKey = useCallback(async () => {
    if (apiKey) {
      try {
        await copyToClipboard(apiKey.secret);
        setHasBeenCopied(true);
      } catch {
        toast.error('Failed to copy — please select and copy the key manually');
      }
    }
  }, [apiKey, copyToClipboard]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as='div'
        className='relative z-10'
        onClose={
          apiKey && !hasBeenCopied ? () => {} : hasBeenCopied ? onSuccess : onClose
        }
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
                  Create API Key
                </DialogTitle>
                <div className='mt-4'>
                  {apiKey ? (
                    <div>
                      <p className='text-foreground-hover mb-3 text-center text-sm'>
                        {apiKey.name ? (
                          <>
                            Key <strong>{apiKey.name}</strong> created.{' '}
                          </>
                        ) : (
                          <>Key created. </>
                        )}
                        Copy it now — it won&apos;t be shown again.
                      </p>
                      <div className='flex items-center justify-center space-x-2'>
                        <button
                          tabIndex={0}
                          onKeyDown={handleEnterOrSpace(copyApiKey)}
                          className='bg-background-hover flex cursor-pointer items-center break-all rounded px-2 py-1 text-left font-mono text-xs'
                          onClick={copyApiKey}
                          title='Click to copy'
                        >
                          {apiKey.secret}
                        </button>
                      </div>
                      <div className='mt-4 flex w-full items-center justify-center space-x-2'>
                        <Button variant='lightAccent' onClick={copyApiKey}>
                          {hasBeenCopied ? 'Copied!' : 'Copy'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Fragment>
                      <label
                        htmlFor='api-key-name'
                        className='text-foreground-hover mb-1 block text-left text-sm'
                      >
                        Name{' '}
                        <span className='text-foreground-hover/60'>
                          (optional)
                        </span>
                      </label>
                      <input
                        id='api-key-name'
                        type='text'
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder='e.g. CI uploader'
                        maxLength={64}
                        className='mb-4 w-full rounded border border-gray-300 bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none'
                      />

                      <label
                        htmlFor='api-key-expires'
                        className='text-foreground-hover mb-1 block text-left text-sm'
                      >
                        Expires
                      </label>
                      <select
                        id='api-key-expires'
                        value={preset}
                        onChange={(e) =>
                          setPreset(e.target.value as ExpiryPreset)
                        }
                        className='mb-2 w-full rounded border border-gray-300 bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none'
                      >
                        <option value='never'>Never</option>
                        <option value='30d'>In 30 days</option>
                        <option value='60d'>In 60 days</option>
                        <option value='90d'>In 90 days</option>
                        <option value='1y'>In 1 year</option>
                        <option value='custom'>Custom date…</option>
                      </select>
                      {preset === 'custom' && (
                        <input
                          type='date'
                          value={customDate}
                          min={minDate}
                          onChange={(e) => setCustomDate(e.target.value)}
                          className='mb-2 w-full rounded border border-gray-300 bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none'
                        />
                      )}

                      <p className='text-foreground-hover mt-4 text-center text-xs'>
                        The key will only be displayed once. Store it somewhere
                        safe — you can delete it later, but you can&apos;t
                        recover it.
                      </p>
                      <span
                        className='mt-4 flex justify-center'
                        onClick={createApiKey}
                        onKeyDown={handleEnterOrSpace(createApiKey)}
                        role='button'
                        tabIndex={0}
                      >
                        <Button variant='lightAccent' disabled={!canSubmit}>
                          {submitting ? 'Generating…' : 'Generate'}
                        </Button>
                      </span>
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

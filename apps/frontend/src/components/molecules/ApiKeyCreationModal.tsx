'use client';

import { expiryPresetToIso } from 'utils/connectApp';

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
import { ApiKey, ApiKeyScope, CreateApiKeyInput } from '@auto-drive/models';
import toast from 'react-hot-toast';
import { Button } from '@auto-drive/ui';
import { handleEnterOrSpace } from 'utils/eventHandler';
import { API_KEY_SCOPES } from 'utils/apiKeyScopes';

type ExpiryPreset = '30d' | '60d' | '90d' | '1y' | 'custom' | 'never';
type Access = 'full' | 'scoped';

const presetToIso = (preset: ExpiryPreset, custom: string): string | null => {
  if (preset === 'custom') {
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
  return expiryPresetToIso(preset);
};

const todayPlus = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const ApiKeyCreationModal = ({
  isOpen,
  onClose,
  onSuccess,
  createKey,
  initialName = '',
  withScopes = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  createKey: (input: CreateApiKeyInput) => Promise<ApiKey>;
  initialName?: string;
  /** Offers scopes. Only organization keys can have them. */
  withScopes?: boolean;
}) => {
  const [name, setName] = useState(initialName);
  const [preset, setPreset] = useState<ExpiryPreset>('never');
  const [customDate, setCustomDate] = useState('');
  const [access, setAccess] = useState<Access>('full');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [hasBeenCopied, setHasBeenCopied] = useState(false);

  const epochRef = useRef(0);
  const [minDate, setMinDate] = useState(() => todayPlus(1));

  const reset = useCallback(() => {
    epochRef.current += 1;
    setName(initialName);
    setPreset('never');
    setCustomDate('');
    setAccess('full');
    setScopes([]);
    setApiKey(null);
    setHasBeenCopied(false);
    setSubmitting(false);
    setMinDate(todayPlus(1));
  }, [initialName]);

  useEffect(() => {
    reset();
  }, [isOpen, reset]);

  const canSubmit =
    !submitting &&
    (preset !== 'custom' || customDate.length > 0) &&
    (access === 'full' || scopes.length > 0);

  const toggleScope = useCallback((scope: ApiKeyScope, checked: boolean) => {
    setScopes((current) =>
      API_KEY_SCOPES.map((entry) => entry.scope).filter((s) =>
        s === scope ? checked : current.includes(s),
      ),
    );
  }, []);

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
    createKey({
      name: trimmed.length === 0 ? null : trimmed,
      expiresAt,
      // Left out for full access, which is also all a personal key can have.
      ...(access === 'scoped' ? { scopes } : {}),
    })
      .then((key) => {
        if (epochRef.current === epoch) {
          setApiKey(key);
          setSubmitting(false);
        }
      })
      .catch((err: Error) => {
        if (epochRef.current === epoch) {
          toast.error(err.message || 'Failed to create API key');
          setSubmitting(false);
        }
      });
  }, [canSubmit, name, preset, customDate, access, scopes, createKey]);

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
          // Not while a key is being created, or it would be made unseen.
          submitting || (apiKey && !hasBeenCopied)
            ? () => {}
            : hasBeenCopied
              ? onSuccess
              : onClose
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
                        <Button variant='lightAccent' onClick={onSuccess}>
                          Done
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

                      {withScopes && (
                        <>
                          <label
                            htmlFor='api-key-access'
                            className='text-foreground-hover mb-1 mt-2 block text-left text-sm'
                          >
                            Access
                          </label>
                          <select
                            id='api-key-access'
                            value={access}
                            onChange={(e) =>
                              setAccess(e.target.value as Access)
                            }
                            className='mb-2 w-full rounded border border-gray-300 bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none'
                          >
                            <option value='full'>Full access</option>
                            <option value='scoped'>Limited to scopes…</option>
                          </select>
                          {access === 'scoped' && (
                            <fieldset className='mb-2 flex flex-col gap-2'>
                              <legend className='sr-only'>Scopes</legend>
                              {API_KEY_SCOPES.map((entry) => (
                                <label
                                  key={entry.scope}
                                  className='flex items-start gap-2 text-left text-sm text-foreground'
                                >
                                  <input
                                    type='checkbox'
                                    className='mt-1'
                                    checked={scopes.includes(entry.scope)}
                                    onChange={(e) =>
                                      toggleScope(entry.scope, e.target.checked)
                                    }
                                  />
                                  <span>
                                    {entry.label}
                                    <span className='text-foreground-hover block text-xs'>
                                      {entry.description}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </fieldset>
                          )}
                        </>
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

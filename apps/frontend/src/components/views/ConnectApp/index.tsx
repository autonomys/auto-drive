'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Button, ROUTES } from '@auto-drive/ui';
import { useNetwork } from 'contexts/network';
import { AuthService } from 'services/auth/auth';
import {
  DEFAULT_CONNECT_EXPIRY_DAYS,
  ParsedExtensionRedirect,
  buildConnectCancelRedirect,
  buildConnectSuccessRedirect,
} from 'utils/connectApp';

type ExpiryPreset = '30d' | '60d' | '90d' | '1y' | 'never';

const expiryPresetToIso = (preset: ExpiryPreset): string | null => {
  if (preset === 'never') return null;
  const now = new Date();
  switch (preset) {
    case '30d':
      now.setDate(now.getDate() + 30);
      return now.toISOString();
    case '60d':
      now.setDate(now.getDate() + 60);
      return now.toISOString();
    case '90d':
      now.setDate(now.getDate() + DEFAULT_CONNECT_EXPIRY_DAYS);
      return now.toISOString();
    case '1y':
      now.setFullYear(now.getFullYear() + 1);
      return now.toISOString();
  }
};

export const ConnectApp = ({
  appName,
  redirectTarget,
  state,
}: {
  appName: string | null;
  redirectTarget: ParsedExtensionRedirect | null;
  state: string | null;
}) => {
  const router = useRouter();
  const { network } = useNetwork();
  const [preset, setPreset] = useState<ExpiryPreset>('90d');
  const [submitting, setSubmitting] = useState(false);

  const handleApprove = useCallback(async () => {
    if (!appName || !redirectTarget || submitting) return;

    setSubmitting(true);
    try {
      const expiresAt = expiryPresetToIso(preset);
      const apiKey = await AuthService.generateApiKey({
        name: appName,
        expiresAt,
      });
      const targetUrl = buildConnectSuccessRedirect(
        redirectTarget.redirectUri,
        apiKey.secret,
        state,
      );
      window.location.replace(targetUrl);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create API key',
      );
      setSubmitting(false);
    }
  }, [appName, preset, redirectTarget, state, submitting]);

  const handleCancel = useCallback(() => {
    if (submitting) return;
    if (redirectTarget) {
      window.location.replace(
        buildConnectCancelRedirect(redirectTarget.redirectUri, state),
      );
      return;
    }
    router.push(ROUTES.drive(network.id));
  }, [network.id, redirectTarget, router, state, submitting]);

  if (!appName || !redirectTarget) {
    return (
      <div className='mx-auto mt-12 max-w-md rounded-2xl border border-gray-200 bg-background p-6 shadow-sm'>
        <h1 className='text-lg font-semibold text-foreground'>
          Invalid connection request
        </h1>
        <p className='text-foreground-hover mt-2 text-sm'>
          {!appName
            ? 'Missing required app_name parameter.'
            : 'The provided redirect_uri must be a valid HTTPS browser extension redirect URL (*.chromiumapp.org or *.extensions.allizom.org).'}
        </p>
        <div className='mt-6 flex justify-end'>
          <Button
            variant='lightAccent'
            onClick={() => router.push(ROUTES.drive(network.id))}
          >
            Back to Auto Drive
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='mx-auto mt-12 max-w-md rounded-2xl border border-gray-200 bg-background p-6 shadow-sm'>
      <h1 className='text-lg font-semibold text-foreground'>Connect app</h1>

      <p className='text-foreground-hover mt-3 text-sm'>
        <strong className='text-foreground'>{appName}</strong>{' '}
        <span className='font-mono text-xs text-gray-500'>
          ({redirectTarget.extensionId})
        </span>{' '}
        wants an API key with <strong>full access</strong> to your account.
      </p>

      <div className='mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-foreground'>
        The application name above is self-declared by the extension. Verify
        that the extension ID{' '}
        <code className='font-mono font-semibold'>
          {redirectTarget.extensionId}
        </code>{' '}
        matches the extension you intend to authorize. You can revoke this key
        at any time on the Developers page.
      </div>

      <div className='mt-4'>
        <label
          htmlFor='connect-key-expires'
          className='text-foreground-hover mb-1 block text-left text-sm'
        >
          Key expiration
        </label>
        <select
          id='connect-key-expires'
          value={preset}
          disabled={submitting}
          onChange={(e) => setPreset(e.target.value as ExpiryPreset)}
          className='w-full rounded border border-gray-300 bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none'
        >
          <option value='30d'>In 30 days</option>
          <option value='60d'>In 60 days</option>
          <option value='90d'>In 90 days (recommended)</option>
          <option value='1y'>In 1 year</option>
          <option value='never'>Never</option>
        </select>
      </div>

      <div className='mt-6 flex items-center justify-end gap-3'>
        <Button
          variant='lightDanger'
          disabled={submitting}
          onClick={handleCancel}
        >
          Cancel
        </Button>
        <Button
          variant='lightAccent'
          disabled={submitting}
          onClick={handleApprove}
        >
          {submitting ? 'Approving…' : 'Approve'}
        </Button>
      </div>
    </div>
  );
};

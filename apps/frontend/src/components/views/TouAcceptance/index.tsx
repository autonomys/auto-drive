'use client';

import { useCallback, useState } from 'react';
import { Button, Checkbox } from '@headlessui/react';
import { CheckIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { AutonomysSymbol } from '@auto-drive/ui';
import { TouStatus } from '@auto-drive/models';
import { useNetwork } from '../../../contexts/network';

export const TouAcceptanceInterstitial = ({
  touStatus,
  onAccepted,
}: {
  touStatus: TouStatus;
  onAccepted: () => void;
}) => {
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const { api } = useNetwork();

  const handleAccept = useCallback(async () => {
    setLoading(true);
    try {
      await api.acceptTou();
      onAccepted();
    } catch (error) {
      console.error('Failed to accept ToU:', error);
    } finally {
      setLoading(false);
    }
  }, [api, onAccepted]);

  const handleDecline = useCallback(() => {
    signOut({ callbackUrl: '/' });
  }, []);

  return (
    <div className='flex h-screen w-screen flex-col items-center justify-center bg-background'>
      <header className='mb-8 flex flex-col items-center justify-between gap-4 md:flex-row md:gap-0'>
        <div className='flex items-center space-x-2 text-foreground'>
          <AutonomysSymbol />
          <span className='text-xl font-semibold'>Auto Drive</span>
        </div>
      </header>
      <div className='flex max-w-lg flex-col items-center gap-6 text-foreground'>
        <h2 className='text-lg font-semibold'>Updated Terms of Use</h2>
        <div className='rounded-lg border border-yellow-300 bg-yellow-50 bg-opacity-60 p-4 dark:border-yellow-700 dark:bg-yellow-900/40 dark:text-foreground'>
          <p className='text-sm'>
            Our Terms of Use have been updated
            {touStatus.currentVersion?.versionLabel
              ? ` (${touStatus.currentVersion.versionLabel})`
              : ''}
            . Please review the changes and accept to continue using Auto Drive.
          </p>
        </div>
        {touStatus.currentVersion?.contentUrl && (
          <a
            rel='noreferrer'
            target='_blank'
            href={touStatus.currentVersion.contentUrl}
            className='text-sm underline'
          >
            Read the full Terms of Use
          </a>
        )}
        <div className='flex items-center gap-2'>
          <Checkbox
            checked={accepted}
            onChange={() => setAccepted((e) => !e)}
            className='group relative block size-4 rounded border-2 border-muted-foreground bg-background data-[checked]:border-blue-500 data-[checked]:bg-blue-500'
          >
            <CheckIcon className='absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 stroke-white opacity-0 group-data-[checked]:opacity-100' />
          </Checkbox>
          <span className='text-sm'>
            I have read and I agree to the updated{' '}
            <a
              rel='noreferrer'
              target='_blank'
              href={
                touStatus.currentVersion?.contentUrl ||
                'https://autonomys.xyz/auto-drive-terms-of-use'
              }
              className='underline'
            >
              Terms of Use
            </a>
          </span>
        </div>
        <div className='flex gap-4'>
          <Button
            className='rounded border border-foreground px-4 py-1 font-semibold text-foreground opacity-100 transition-all duration-300 hover:scale-105 hover:opacity-80'
            onClick={handleDecline}
          >
            Decline
          </Button>
          <Button
            className='rounded bg-foreground px-4 py-1 font-semibold text-background opacity-100 transition-all duration-300 hover:scale-105 hover:opacity-80 disabled:opacity-50'
            disabled={!accepted || loading}
            onClick={handleAccept}
          >
            {loading ? 'Accepting...' : 'Accept'}
          </Button>
        </div>
        <p className='text-center text-xs text-muted-foreground'>
          If you decline, you will be signed out and unable to use Auto Drive
          until you accept the updated terms.
        </p>
      </div>
    </div>
  );
};

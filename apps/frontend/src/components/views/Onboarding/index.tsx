'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox } from '@headlessui/react';
import { CheckIcon } from 'lucide-react';
import { AuthService } from 'services/auth/auth';
import { Disclaimer } from '@/components/atoms/Disclaimer';
import {
  EXTERNAL_ROUTES,
  ROUTES,
  AutonomysSymbol,
  defaultNetworkId,
  getNetwork,
} from '@auto-drive/ui';
import { getAuthSession } from 'utils/auth';

const acceptTouAfterOnboarding = async () => {
  try {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) return;
    const network = getNetwork(defaultNetworkId);
    await fetch(`${network.http}/tou/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });
  } catch {
    // Best-effort: if ToU acceptance fails here, the interstitial will catch it
  }
};

const fetchCurrentTouUrl = async (): Promise<string | null> => {
  try {
    const session = await getAuthSession();
    if (!session?.authProvider || !session.accessToken) return null;
    const network = getNetwork(defaultNetworkId);
    const response = await fetch(`${network.http}/tou/status`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Auth-Provider': session.authProvider,
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.currentVersion?.contentUrl ?? null;
  } catch {
    return null;
  }
};

export const Onboarding = () => {
  const [accepted, setAccepted] = useState(false);
  const [touUrl, setTouUrl] = useState(EXTERNAL_ROUTES.termsOfUse);

  useEffect(() => {
    fetchCurrentTouUrl().then((url) => {
      if (url) setTouUrl(url);
    });
  }, []);

  const onboardUser = useCallback(async () => {
    AuthService.onboardUser()
      .then(async () => {
        await acceptTouAfterOnboarding();
        window.location.assign(ROUTES.drive());
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  return (
    <div className='flex h-screen flex-col items-center justify-center bg-background'>
      <header className='mb-8 flex flex-col items-center justify-between gap-4 md:flex-row md:gap-0'>
        <div className='flex items-center space-x-2 text-foreground'>
          <AutonomysSymbol />
          <span className='text-xl font-semibold'>Auto Drive</span>
        </div>
      </header>
      <div className='flex flex-col items-center gap-4 text-foreground'>
        <Disclaimer />
        <div className='flex items-center gap-2'>
          <Checkbox
            checked={accepted}
            onChange={() => setAccepted((e) => !e)}
            className='group relative block size-4 rounded border-2 border-muted-foreground bg-background data-[checked]:border-blue-500 data-[checked]:bg-blue-500'
          >
            <CheckIcon className='absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 stroke-white opacity-0 group-data-[checked]:opacity-100' />
          </Checkbox>
          <span className='text-sm'>
            I have read and I accept the{' '}
            <a
              rel='noreferrer'
              target='_blank'
              href={touUrl}
              className='underline'
            >
              Terms of Use
            </a>
          </span>
        </div>
        <Button
          className='rounded bg-foreground px-4 py-1 font-semibold text-background opacity-100 transition-all duration-300 hover:scale-105 hover:opacity-80 disabled:opacity-50'
          disabled={!accepted}
          onClick={onboardUser}
        >
          Start
        </Button>
      </div>
    </div>
  );
};

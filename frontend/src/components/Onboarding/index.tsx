'use client';

import { useCallback, useState } from 'react';
import { Button, Checkbox } from '@headlessui/react';
import { CheckIcon } from 'lucide-react';
import { AuthService } from 'services/auth/auth';
import { Disclaimer } from 'components/common/Disclaimer';
import { ROUTES } from 'constants/routes';
import { AutonomysSymbol } from 'components/common/AutonomysSymbol';

export const Onboarding = () => {
  const [accepted, setAccepted] = useState(false);

  const onboardUser = useCallback(async () => {
    AuthService.onboardUser()
      .then(() => {
        window.location.assign(ROUTES.drive());
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  return (
    <div className='flex h-screen flex-col items-center justify-center bg-white dark:bg-darkWhite'>
      <header className='mb-8 flex flex-col items-center justify-between gap-4 md:flex-row md:gap-0'>
        <div className='flex items-center space-x-2 text-black dark:text-darkBlack'>
          <AutonomysSymbol />
          <span className='text-xl font-semibold'>Auto Drive</span>
        </div>
      </header>
      <div className='flex flex-col items-center gap-4 dark:text-darkBlack'>
        <Disclaimer />
        <div className='flex items-center gap-2'>
          <Checkbox
            checked={accepted}
            onChange={() => setAccepted((e) => !e)}
            className='group relative block size-4 rounded border bg-white data-[checked]:bg-blue-500 dark:bg-darkWhite'
          >
            <CheckIcon className='absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 stroke-white opacity-0 group-data-[checked]:opacity-100' />
          </Checkbox>
          <span className='text-sm'>
            I have read and I accept the{' '}
            <a
              rel='noreferrer'
              target='_blank'
              href='https://www.autonomys.xyz/terms-of-use'
              className='underline'
            >
              terms and conditions
            </a>
          </span>
        </div>
        <Button
          className={
            'rounded bg-black px-4 py-1 font-semibold text-white opacity-100 transition-all duration-300 hover:scale-105 hover:bg-gray-800 disabled:opacity-50 dark:bg-darkBlack dark:text-darkWhite dark:hover:bg-darkBlack dark:hover:opacity-80'
          }
          disabled={!accepted}
          onClick={onboardUser}
        >
          Start
        </Button>
      </div>
    </div>
  );
};

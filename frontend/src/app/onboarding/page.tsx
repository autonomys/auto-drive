'use client';

import { Button } from '@headlessui/react';
import { useCallback } from 'react';
import { ApiService } from '../../services/api';
import Image from 'next/image';
import { Disclaimer } from '../../components/common/Disclaimer';

export default function OnboardingPage() {
  const onboardUser = useCallback(async () => {
    ApiService.onboardUser()
      .then(() => {
        window.location.assign('/drive');
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  return (
    <div className='flex h-screen flex-col items-center justify-center'>
      <header className='mb-8 flex flex-col items-center justify-between gap-4 md:flex-row md:gap-0'>
        <div className='flex items-center space-x-2'>
          <Image src='/autonomys.png' alt='Auto Drive' width={32} height={32} />
          <span className='text-xl font-semibold'>Auto Drive</span>
        </div>
      </header>
      <div className='flex flex-col items-center gap-4'>
        <Disclaimer />
        <Button
          className={
            'rounded bg-black px-4 py-1 font-semibold text-white opacity-100 transition-all duration-300 hover:scale-105 hover:bg-gray-800'
          }
          onClick={onboardUser}
        >
          Accept
        </Button>
      </div>
    </div>
  );
}

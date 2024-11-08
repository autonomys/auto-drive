'use client';

import { Button } from '@headlessui/react';
import { useCallback, useState } from 'react';
import { ApiService } from '../../services/api';
import { Loader } from 'lucide-react';
import Image from 'next/image';

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const onboardUser = useCallback(async () => {
    setIsLoading(true);
    ApiService.onboardUser()
      .then(() => {
        window.location.assign('/drive');
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const nextStep = useCallback(() => {
    setTransitioning(true);
    setTimeout(() => {
      setStep((a) => a + 1);
      setTransitioning(false);
    }, 300); // Match this duration with the CSS transition duration
  }, []);

  const steps = [
    <div className='flex flex-col items-center gap-4' key={0}>
      <span className='text-2xl font-bold'>Welcome to Auto Drive</span>
      <span className='w-[20rem] text-center text-sm text-gray-500'>
        Auto-Drive is a file storage and sharing service that allows you to
        store and share files with others.
      </span>
      <Button
        className={
          'rounded bg-black px-4 py-1 font-semibold text-white opacity-100 transition-all duration-300 hover:scale-105 hover:bg-gray-800'
        }
        onClick={nextStep}
      >
        Accept
      </Button>
    </div>,
    <div className='flex flex-col items-center gap-4' key={1}>
      <span className='text-2xl font-bold'>Terms of Service</span>
      <span className='text-sm text-gray-500'>
        Auto-Drive <strong>is public by default.</strong>
      </span>
      <span className='text-sm text-gray-500'>
        You <strong>can setup encryption</strong> but the encrypted file would
        be public.
      </span>
      <Button
        className={
          'rounded bg-black px-4 py-1 font-semibold text-white opacity-100 transition-all duration-300 hover:scale-105 hover:bg-gray-800'
        }
        onClick={nextStep}
      >
        Accept
      </Button>
    </div>,
    <div className='flex flex-col items-center gap-4' key={2}>
      <span className='text-2xl font-bold'>Terms of Service</span>
      <span className='text-sm text-gray-500'>
        Auto-Drive saves files in Autonomy&apos;s network so files{' '}
        <strong>won&apos;t be able to be deleted</strong> by anyone.
      </span>
      <Button
        className={
          'rounded bg-black px-4 py-1 font-semibold text-white opacity-100 transition-all duration-300 hover:scale-105 hover:bg-gray-800'
        }
        onClick={onboardUser}
      >
        {isLoading ? <Loader className='h-4 w-4 animate-spin' /> : 'Accept'}
      </Button>
    </div>,
  ];

  const currentStep = steps[step];

  return (
    <div className='flex h-screen flex-col items-center justify-center'>
      <header className='mb-8 flex flex-col items-center justify-between gap-4 md:flex-row md:gap-0'>
        <div className='flex items-center space-x-2'>
          <Image src='/autonomys.png' alt='Auto Drive' width={32} height={32} />
          <span className='text-xl font-semibold'>Auto Drive</span>
        </div>
      </header>
      <div
        className={`transition-opacity duration-300 ${
          transitioning ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {currentStep}
      </div>
    </div>
  );
}

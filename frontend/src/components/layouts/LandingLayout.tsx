'use client';

import LandingFooter from '@/components/molecules/LandingFooter';
import { LandingHeader } from '@/components/molecules/LandingHeader';
import { SessionProvider } from 'next-auth/react';

export const LandingLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className='flex min-h-screen flex-col'>
      <LandingHeader />
      <SessionProvider>{children}</SessionProvider>
      <LandingFooter />
    </div>
  );
};

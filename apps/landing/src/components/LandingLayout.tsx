'use client';

import LandingFooter from '@/components/LandingFooter';
import { LandingHeader } from '@/components/LandingHeader';

export const LandingLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className='flex min-h-screen flex-col'>
      <LandingHeader />
      {children}
      <LandingFooter />
    </div>
  );
};

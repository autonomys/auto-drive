'use client';

import LandingFooter from '@/components/molecules/LandingFooter';
import { LandingHeader } from '@/components/molecules/LandingHeader';

export const LandingLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className='flex min-h-screen flex-col'>
      <LandingHeader />
      {children}
      <LandingFooter />
    </div>
  );
};

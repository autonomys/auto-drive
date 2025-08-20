'use client';

import LandingFooter from '@/components/molecules/LandingFooter';
import { LandingHeader } from '@/components/molecules/LandingHeader';
import { SessionProvider } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { defaultNetworkId } from '../../constants/networks';
import { getAuthSession } from '../../utils/auth';
import { useEffect } from 'react';

export const LandingLayout = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  useEffect(() => {
    getAuthSession().then((session) => {
      if (session) {
        router.push(`/${defaultNetworkId}/drive`);
      }
    });
  }, [router]);

  return (
    <div className='flex min-h-screen flex-col'>
      <LandingHeader />
      <SessionProvider>{children}</SessionProvider>
      <LandingFooter />
    </div>
  );
};

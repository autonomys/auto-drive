'use client';

import '../../globals.css';
import { UserEnsurer } from '@/components/atoms/UserEnsurer';
import { useEffect, useMemo } from 'react';
import { useUserStore } from 'globalStates/user';
import { SessionProvider } from 'next-auth/react';
import { defaultNetworkId, NetworkId, networks } from 'constants/networks';
import { NetworkProvider } from 'contexts/network';
import { redirect } from 'next/navigation';
import { TopNavbar } from '@/components/organisms/TopNavbar';
import { SideNavbar } from '@/components/organisms/SideNavbar';
import { AuthService } from 'services/auth/auth';
import { TableRouteChangeListener } from '@/components/organisms/FileTable/TableRouteChangeListener';

export default function AppLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: { chain: NetworkId };
}>) {
  const setUser = useUserStore(({ setUser }) => setUser);

  useEffect(() => {
    AuthService.getMe().then((user) => {
      if (user.onboarded) {
        setUser(user);
      } else {
        redirect('/onboarding');
      }
    });
  }, [setUser]);

  const network = useMemo(() => {
    return networks[params.chain] || null;
  }, [params.chain]);
  if (!network) {
    redirect(`/${defaultNetworkId}/drive`);
  }

  return (
    <div className='min-h-screen bg-white dark:bg-darkWhite'>
      <div className='flex h-screen flex-col rounded-lg bg-white dark:bg-darkWhite dark:text-white'>
        <TopNavbar networkId={params.chain} />
        <div className='flex flex-1 overflow-hidden px-10'>
          <UserEnsurer>
            <NetworkProvider network={network}>
              <SideNavbar networkId={params.chain} />
              <main className='flex-1 overflow-auto px-6 pb-6'>
                <SessionProvider>
                  <TableRouteChangeListener />
                  {children}
                </SessionProvider>
              </main>
            </NetworkProvider>
          </UserEnsurer>
        </div>
      </div>
    </div>
  );
}

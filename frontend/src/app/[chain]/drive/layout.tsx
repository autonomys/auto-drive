'use client';

import '../../globals.css';
import { UserEnsurer } from '@/components/atoms/UserEnsurer';
import { useEffect, useMemo } from 'react';
import { useUserStore } from 'globalStates/user';
import { SessionProvider } from 'next-auth/react';
import { defaultNetworkId, NetworkId, networks } from 'constants/networks';
import { NetworkProvider } from 'contexts/network';
import { redirect, useRouter } from 'next/navigation';
import { TopNavbar } from '@/components/organisms/TopNavbar';
import { AuthService } from 'services/auth/auth';
import { TableRouteChangeListener } from '@/components/organisms/FileTable/TableRouteChangeListener';
import { SidebarProvider } from '@/components/molecules/Sidebar';
import { SideNavbar } from '@/components/organisms/SideNavbar';

export default function AppLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: { chain: NetworkId };
}>) {
  const setUser = useUserStore(({ setUser }) => setUser);
  const router = useRouter();

  useEffect(() => {
    AuthService.getMe()
      .then((user) => {
        if (user.onboarded) {
          setUser(user);
        } else {
          router.push('/onboarding');
        }
      })
      .catch(() => {
        router.replace('/');
      });
  }, [setUser]);

  const network = useMemo(() => {
    return networks[params.chain] || null;
  }, [params.chain]);
  if (!network) {
    router.replace(`/${defaultNetworkId}/drive`);
  }

  return (
    <div className='flex min-h-screen bg-white dark:bg-darkWhite'>
      <SidebarProvider className='contents'>
        <SideNavbar networkId={params.chain} />
        <div className='flex h-screen flex-1 flex-col rounded-lg bg-white dark:bg-darkWhite dark:text-white'>
          <TopNavbar networkId={params.chain} />
          <div className='flex flex-1 overflow-hidden'>
            <UserEnsurer>
              <NetworkProvider network={network}>
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
      </SidebarProvider>
    </div>
  );
}

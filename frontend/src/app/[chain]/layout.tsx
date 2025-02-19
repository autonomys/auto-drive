'use client';

import '../globals.css';
import { UserEnsurer } from 'components/UserEnsurer';
import { useEffect, useMemo } from 'react';
import { useUserStore } from 'globalStates/user';
import { SessionProvider } from 'next-auth/react';
import { defaultNetworkId, NetworkId, networks } from 'constants/networks';
import { NetworkProvider } from 'contexts/network';
import { redirect } from 'next/navigation';
import { TopNavbar } from 'components/Navbar/TopNavbar';
import { SideNavbar } from 'components/Navbar/SideNavbar';
import { AuthService } from 'services/auth/auth';

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
      setUser(user);
    });
  }, [setUser]);

  const network = useMemo(() => {
    return networks[params.chain] || null;
  }, [params.chain]);
  if (!network) {
    redirect(`/${defaultNetworkId}/drive`);
  }

  return (
    <div className='min-h-screen bg-white dark:bg-darkWhite dark:bg-gray-900'>
      <div className='flex h-screen flex-col rounded-lg bg-white dark:bg-darkWhite dark:text-white'>
        <TopNavbar networkId={params.chain} />
        <div className='flex flex-1 overflow-hidden px-10'>
          <UserEnsurer>
            <SideNavbar networkId={params.chain} />
            <main className='flex-1 overflow-auto p-6'>
              <SessionProvider>
                <NetworkProvider network={network}>{children}</NetworkProvider>
              </SessionProvider>
            </main>
          </UserEnsurer>
        </div>
      </div>
    </div>
  );
}

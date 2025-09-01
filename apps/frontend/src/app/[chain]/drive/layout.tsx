'use client';

import '../../globals.css';
import { useMemo } from 'react';
import { SessionProvider } from 'next-auth/react';
import { defaultNetworkId, NetworkId, networks } from '@auto-drive/ui';
import { NetworkProvider } from 'contexts/network';
import { useRouter } from 'next/navigation';
import { TopNavbar } from '@/components/organisms/TopNavbar';
import { TableRouteChangeListener } from '@/components/organisms/FileTable/TableRouteChangeListener';
import { SidebarProvider } from '@/components/molecules/Sidebar';
import { SideNavbar } from 'frontend/src/components/organisms/SideNavBar';
import { SessionEnsurer } from '@/components/atoms/SessionEnsurer';

export default function AppLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: { chain: NetworkId };
}>) {
  const router = useRouter();

  const network = useMemo(() => {
    return networks[params.chain] || null;
  }, [params.chain]);
  if (!network) {
    router.replace(`/${defaultNetworkId}/drive`);
    return null;
  }

  return (
    <div className='dark:bg-darkWhite flex min-h-screen bg-white'>
      <SessionProvider>
        <NetworkProvider network={network}>
          <SessionEnsurer>
            <SidebarProvider className='contents'>
              <SideNavbar networkId={params.chain} />
              <div className='dark:bg-darkWhite flex h-screen flex-1 flex-col rounded-lg bg-white dark:text-white'>
                <TopNavbar networkId={params.chain} />
                <div className='flex flex-1 overflow-hidden'>
                  <main className='flex-1 overflow-auto px-6 pb-6'>
                    <TableRouteChangeListener />
                    {children}
                  </main>
                </div>
              </div>
            </SidebarProvider>
          </SessionEnsurer>
        </NetworkProvider>
      </SessionProvider>
    </div>
  );
}

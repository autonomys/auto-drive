'use client';

import '../../globals.css';
import { useMemo } from 'react';
import { SessionProvider } from 'next-auth/react';
import { defaultNetworkId, NetworkId, networks } from '@auto-drive/ui';
import { NetworkProvider, useNetwork } from 'contexts/network';
import { useRouter } from 'next/navigation';
import { TopNavbar } from '@/components/organisms/TopNavbar';
import { TableRouteChangeListener } from '@/components/organisms/FileTable/TableRouteChangeListener';
import { SidebarProvider } from '@/components/molecules/Sidebar';
import { SideNavbar } from 'frontend/src/components/organisms/SideNavBar';
import { SessionEnsurer } from '@/components/atoms/SessionEnsurer';
import { AutomaticLoginWrapper } from '../../../components/atoms/AutomaticLoginWrapper';

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { network } = useNetwork();

  return (
    <div className='flex min-h-screen bg-background'>
      <AutomaticLoginWrapper>
        <SessionProvider>
          <SessionEnsurer>
            <SidebarProvider className='contents'>
              <SideNavbar networkId={network.id} />
              <div className='flex h-screen flex-1 flex-col rounded-lg bg-background text-foreground'>
                <TopNavbar networkId={network.id} />
                <div className='flex flex-1 overflow-hidden'>
                  <main className='flex-1 overflow-auto px-6 pb-6'>
                    <TableRouteChangeListener />
                    {children}
                  </main>
                </div>
              </div>
            </SidebarProvider>
          </SessionEnsurer>
        </SessionProvider>
      </AutomaticLoginWrapper>
    </div>
  );
}

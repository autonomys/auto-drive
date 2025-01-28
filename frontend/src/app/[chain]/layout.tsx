'use client';

import {
  HomeIcon,
  SettingsIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  Earth,
} from 'lucide-react';
import { InternalLink } from '../../components/common/InternalLink';
import '../globals.css';
import { UserEnsurer } from '../../components/UserEnsurer';
import { RoleProtected } from '../../components/RoleProtected';
import { UserRole } from '../../models/User';
import { RemainingCreditTracker } from '../../components/RemainingCreditTracker';
import { useMemo } from 'react';
import Image from 'next/image';
import { useUserStore } from '../../states/user';
import { SessionProvider } from 'next-auth/react';
import {
  defaultNetworkId,
  NetworkId,
  networks,
} from '../../constants/networks';
import { NetworkProvider } from '../../contexts/network';
import { redirect } from 'next/navigation';
import { NetworkDropdown } from '../../components/NetworkDropdown';

export default function AppLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: { chain: NetworkId };
}>) {
  const subscription = useUserStore(({ subscription }) => subscription);

  const startDate = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1).toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      },
    );
  }, []);

  const endDate = useMemo(() => {
    const date = new Date();
    return new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
    ).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  const network = useMemo(() => {
    return networks[params.chain] || null;
  }, [params.chain]);
  if (!network) {
    redirect(`/${defaultNetworkId}/drive`);
  }

  return (
    <div className='min-h-screen bg-white'>
      <div className='flex h-screen flex-col rounded-lg bg-white'>
        <header className='mb-8 flex w-full flex-col items-center justify-between gap-4 border-b-[0.2px] border-[#000000] px-16 py-2 md:flex-row md:gap-0'>
          <div className='flex w-full items-center justify-between space-x-2'>
            <div className='flex items-center space-x-2'>
              <Image
                src='/autonomys.png'
                alt='Auto Drive'
                width={16}
                height={16}
              />
              <span className='text-md font-medium'>Auto Drive</span>
            </div>
            <NetworkDropdown
              selected={network}
              onChange={(value) => {
                window.location.assign(`/${value.id}/drive`);
              }}
            />
          </div>
        </header>
        <div className='flex flex-1 overflow-hidden px-10'>
          <UserEnsurer>
            <aside className='w-12 md:w-48'>
              <InternalLink
                className='contents'
                href={`/${params.chain}/drive`}
              >
                <button className='mb-2 flex items-center space-x-2 text-black hover:text-blue-600'>
                  <HomeIcon className='h-5 w-5' />
                  <span className='hidden md:block'>Files</span>
                </button>
              </InternalLink>
              <InternalLink
                className='contents'
                href={`/${params.chain}/drive/global`}
              >
                <button className='mb-2 flex items-center space-x-2 text-black hover:text-blue-600'>
                  <Earth className='h-5 w-5' />
                  <span className='hidden md:block'>Global Feed</span>
                </button>
              </InternalLink>
              <InternalLink
                className='contents'
                href={`/${params.chain}/drive/shared`}
              >
                <button className='mb-2 flex items-center space-x-2 text-black hover:text-blue-600'>
                  <UsersIcon className='h-5 w-5' />
                  <span className='hidden md:block'>Shared with me</span>
                </button>
              </InternalLink>
              <InternalLink
                className='contents'
                href={`/${params.chain}/drive/trash`}
              >
                <button className='mb-2 flex items-center space-x-2 text-black hover:text-blue-600'>
                  <TrashIcon className='h-5 w-5' />
                  <span className='hidden md:block'>Trash</span>
                </button>
              </InternalLink>
              <InternalLink
                className='contents'
                href={`/${params.chain}/drive/profile`}
              >
                <button className='mb-2 flex items-center space-x-2 text-black hover:text-blue-600'>
                  <UserIcon className='h-5 w-5' />
                  <span className='hidden md:block'>Profile</span>
                </button>
              </InternalLink>
              <RoleProtected roles={[UserRole.Admin]}>
                <InternalLink
                  className='contents'
                  href={`/${params.chain}/drive/admin`}
                >
                  <button className='mb-2 flex items-center space-x-2 text-black hover:text-blue-600'>
                    <SettingsIcon className='h-5 w-5' />
                    <span className='hidden md:block'>Admin</span>
                  </button>
                </InternalLink>
              </RoleProtected>
              {subscription && (
                <RemainingCreditTracker
                  uploadPending={subscription.pendingUploadCredits}
                  uploadLimit={subscription.uploadLimit}
                  downloadPending={subscription.pendingDownloadCredits}
                  downloadLimit={subscription.downloadLimit}
                  startDate={startDate}
                  endDate={endDate}
                />
              )}
            </aside>
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

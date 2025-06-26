import React, { useMemo } from 'react';
import { NetworkDropdown } from '../NetworkDropdown';
import { redirect } from 'next/navigation';
import { defaultNetworkId, NetworkId, networks } from 'constants/networks';
import { AutonomysSymbol } from 'components/common/AutonomysSymbol';
import { ProfileDropdown } from './ProfileDropdown';
import { useUserStore } from '@/globalStates/user';
import { InternalLink } from '../common/InternalLink';

export type TopNavbarProps = {
  networkId: NetworkId;
};

export const TopNavbar = ({ networkId }: TopNavbarProps) => {
  const network = useMemo(() => {
    return networks[networkId] || null;
  }, [networkId]);
  const { user } = useUserStore((state) => state);

  if (!network) {
    redirect(`/${defaultNetworkId}/drive`);
  }

  return (
    <header className='mb-8 flex w-full flex-col items-center justify-between gap-4 border-b-[0.2px] border-[#000000] px-16 py-2 md:flex-row md:gap-0'>
      <div className='flex w-full items-center justify-between space-x-2'>
        <InternalLink
          href={`/${networkId}/drive`}
          className='hover:cursor-pointer'
        >
          <div className='flex items-center space-x-2'>
            <AutonomysSymbol />
            <span className='text-md font-medium'>Auto Drive</span>
          </div>
        </InternalLink>
        <div className='flex items-center space-x-4'>
          <NetworkDropdown
            selected={network}
            onChange={(value) => {
              window.location.assign(`/${value.id}/drive`);
            }}
          />
          {user && <ProfileDropdown />}
        </div>
      </div>
    </header>
  );
};

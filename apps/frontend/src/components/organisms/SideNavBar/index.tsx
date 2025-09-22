import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  SidebarHeader,
  Sidebar,
  SidebarFooter,
  useSidebar,
  SidebarContent,
} from '../../molecules/Sidebar';
import { useUserStore } from '../../../globalStates/user';
import { SubscriptionGranularity, UserRole } from '@auto-drive/models';
import { AutonomysSymbol, Button, NetworkId } from '@auto-drive/ui';
import { AccountInformation } from '../../molecules/AccountInformation';
import dayjs from 'dayjs';
import { SessionContext } from 'next-auth/react';
import { AuthModal } from '../../molecules/AuthModal';
import { BuyMoreCreditsButton } from '../../atoms/AskForCredits';
import { SIDEBAR_DEFINITION } from './items';
import { SideNavBarContent } from './SideNavBarContent';

export type SideNavbarProps = {
  networkId: NetworkId;
};

export const SideNavbar = ({ networkId }: SideNavbarProps) => {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { user, subscription } = useUserStore();
  const { state } = useSidebar();

  const session = useContext(SessionContext);

  const isLoggedIn = !!session?.data;
  const isAdmin = isLoggedIn && user?.role === UserRole.Admin;

  const collapsed = state === 'collapsed';

  const handleOpenAuthModal = useCallback(() => {
    setIsAuthModalOpen(true);
  }, []);

  const renewalDate = useMemo(() => {
    const date = dayjs().add(1, 'month').startOf('month');
    return date.toDate();
  }, []);

  const sidebarItems = SIDEBAR_DEFINITION.filter((e) => {
    if (e.onlyAdmin) {
      return isAdmin;
    }
    return true;
  });

  return (
    <Sidebar className='border-r bg-card'>
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
      <SidebarHeader className='p-4'>
        <div className='flex items-center space-x-2'>
          <AutonomysSymbol />
          {!collapsed && (
            <div>
              <h2 className='text-sm font-semibold'>Auto Drive</h2>
              <p className='text-xs text-muted-foreground'>Permanent Storage</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SideNavBarContent
          sidebarItems={sidebarItems}
          handleOpenAuthModal={handleOpenAuthModal}
          networkId={networkId}
          isLoggedIn={isLoggedIn}
          collapsed={collapsed}
        />
      </SidebarContent>
      <SidebarFooter className='p-4'>
        {isLoggedIn && (
          <AccountInformation
            granularity={
              subscription?.granularity ?? SubscriptionGranularity.OneOff
            }
            renewalDate={renewalDate}
            uploadLimit={subscription?.uploadLimit ?? 0}
            uploadPending={subscription?.pendingUploadCredits ?? 0}
          />
        )}
        {isLoggedIn && subscription ? (
          <BuyMoreCreditsButton />
        ) : (
          <Button
            variant='outline'
            size='sm'
            className='w-full text-xs'
            onClick={handleOpenAuthModal}
          >
            Log In
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};

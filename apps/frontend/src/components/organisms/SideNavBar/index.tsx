import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  SidebarHeader,
  Sidebar,
  SidebarFooter,
  useSidebar,
  SidebarContent,
} from '../../molecules/Sidebar';
import { useUserStore } from '../../../globalStates/user';
import { AccountModel, UserRole } from '@auto-drive/models';
import { AutonomysSymbol, Button, NetworkId } from '@auto-drive/ui';
import { AccountInformation } from '../../molecules/AccountInformation';
import dayjs from 'dayjs';
import { SessionContext } from 'next-auth/react';
import { AuthModal } from '../../molecules/AuthModal';
import { SIDEBAR_DEFINITION } from './items';
import { SideNavBarContent } from './SideNavBarContent';
import { AskForCreditsButton } from '../../atoms/AskForCredits';
import { BuyMoreCreditsButton } from '../../atoms/BuyMoreCreditsButton';

export type SideNavbarProps = {
  networkId: NetworkId;
};

export const SideNavbar = ({ networkId }: SideNavbarProps) => {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { user, account, features } = useUserStore();
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
    <Sidebar className='bg-card'>
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
            model={account?.model ?? AccountModel.OneOff}
            renewalDate={renewalDate}
            uploadLimit={account?.uploadLimit ?? 0}
            uploadPending={account?.pendingUploadCredits ?? 0}
          />
        )}
        {isLoggedIn && account ? (
          features.buyCredits ? (
            <BuyMoreCreditsButton />
          ) : (
            <AskForCreditsButton />
          )
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

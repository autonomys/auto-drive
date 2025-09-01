import { NetworkId } from 'constants/networks';
import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  SidebarHeader,
  Sidebar,
  SidebarFooter,
  useSidebar,
  SidebarContent,
  SidebarMenuButton,
} from '../../molecules/Sidebar';
import { useUserStore } from '../../../globalStates/user';
import { UserRole } from '@auto-drive/models';
import { AutonomysSymbol } from '../../icons/AutonomysSymbol';
import { AccountInformation } from '../../molecules/AccountInformation';
import dayjs from 'dayjs';
import { SessionContext } from 'next-auth/react';
import { AuthModal } from '../../molecules/AuthModal';
import { Button } from '../../atoms/Button';
import { AskForCreditsButton } from '../../atoms/AskForCredits';
import { SIDEBAR_DEFINITION } from './items';
import { SideNavBarContent } from './SideNavBarContent';
import { ArrowLeftIcon } from 'lucide-react';
import { InternalLink } from '../../atoms/InternalLink';

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
    <Sidebar className='bg-card border-r'>
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
              <p className='text-muted-foreground text-xs'>Permanent Storage</p>
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
        <InternalLink href='/'>
          <SidebarMenuButton>
            <ArrowLeftIcon className='h-4 w-4' />
            <span>Go back to landing</span>
          </SidebarMenuButton>
        </InternalLink>
        {isLoggedIn && (
          <AccountInformation
            renewalDate={renewalDate}
            uploadLimit={subscription?.uploadLimit ?? 0}
            uploadPending={subscription?.pendingUploadCredits ?? 0}
          />
        )}
        {isLoggedIn && subscription ? (
          <AskForCreditsButton />
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

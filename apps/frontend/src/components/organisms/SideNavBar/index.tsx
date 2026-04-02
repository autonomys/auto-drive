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
import {
  AutonomysSymbol,
  Button,
  EXTERNAL_ROUTES,
  NetworkId,
} from '@auto-drive/ui';
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
  const { user, account, features, creditSummary } = useUserStore();
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

  const hasBuyCreditsFeature =
    features.buyCredits && isLoggedIn && account?.model === AccountModel.OneOff;

  // Purchased-credit fields — only derived when the buyCredits feature is
  // active for this user.  Both values default to "not shown" otherwise,
  // which keeps the sidebar unchanged for Monthly, free-only OneOff, and
  // any account whose operator has disabled the feature flag.
  const purchasedBytesRemaining = useMemo(() => {
    if (!hasBuyCreditsFeature || !creditSummary) return 0;
    // creditSummary.uploadBytesRemaining is a decimal-string bigint from the
    // API.  Max value is 100 GiB which is well within Number's safe range.
    return Number(creditSummary.uploadBytesRemaining);
  }, [hasBuyCreditsFeature, creditSummary]);

  const nextExpiryDate = useMemo(() => {
    if (!hasBuyCreditsFeature || !creditSummary?.nextExpiryDate) return null;
    return new Date(creditSummary.nextExpiryDate);
  }, [hasBuyCreditsFeature, creditSummary]);

  const creditHistoryHref = hasBuyCreditsFeature
    ? `/${networkId}/drive/credits`
    : undefined;

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
            purchasedBytesRemaining={purchasedBytesRemaining}
            nextExpiryDate={nextExpiryDate}
            creditHistoryHref={creditHistoryHref}
          />
        )}
        {isLoggedIn && account ? (
          hasBuyCreditsFeature ? (
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
        {!collapsed && (
          <div className='mt-2 flex gap-2 text-[10px] text-muted-foreground'>
            <a
              href={EXTERNAL_ROUTES.termsOfUse}
              target='_blank'
              rel='noreferrer'
              className='hover:underline'
            >
              Terms
            </a>
            <span>&middot;</span>
            <a
              href={EXTERNAL_ROUTES.privacyPolicy}
              target='_blank'
              rel='noreferrer'
              className='hover:underline'
            >
              Privacy
            </a>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};

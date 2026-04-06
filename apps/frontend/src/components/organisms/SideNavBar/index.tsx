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

  // creditSummary is always loaded for any logged-in user (see SessionEnsurer),
  // so we can safely derive purchasedBytesRemaining from it regardless of the
  // feature flag.  This is needed to separate free vs. purchased bytes in the
  // progress bar even when the buy-credits UI is hidden.
  const purchasedBytesRemaining = useMemo(() => {
    if (!creditSummary) return 0;
    // uploadBytesRemaining is a decimal-string bigint from the API.
    // Max safe value is 100 GiB which is well within Number's safe range.
    return Number(creditSummary.uploadBytesRemaining);
  }, [creditSummary]);

  // Total bytes originally purchased (sum of upload_bytes_original for active rows).
  // Used to render a "X used out of Y total" progress bar in the purchased credits section.
  const purchasedBytesTotal = useMemo(() => {
    // totalPurchasedBytesOriginal is a new field — older backend versions will
    // omit it. Guard with nullish coalescing so the UI degrades gracefully
    // (hides the progress bar) rather than rendering "N/A".
    if (!creditSummary?.totalPurchasedBytesOriginal) return 0;
    return Number(creditSummary.totalPurchasedBytesOriginal);
  }, [creditSummary]);

  // account.pendingUploadCredits = freeRemaining + purchasedRemaining.
  // Strip out the purchased portion so the free-quota progress bar only
  // reflects the free allocation.
  const freeRemaining = (account?.pendingUploadCredits ?? 0) - purchasedBytesRemaining;

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
            uploadPending={freeRemaining}
            purchasedBytesRemaining={hasBuyCreditsFeature ? purchasedBytesRemaining : 0}
            purchasedBytesTotal={hasBuyCreditsFeature ? purchasedBytesTotal : 0}
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

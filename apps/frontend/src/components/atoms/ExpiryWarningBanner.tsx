'use client';

import { useQuery } from '@tanstack/react-query';
import { BannerCriticality } from '@auto-drive/models';
import { useNetwork } from '../../contexts/network';
import { ExpiringCreditBatch } from '../../services/api';
import { SessionContext } from 'next-auth/react';
import { useContext } from 'react';
import {
  daysUntilExpiry,
  sumExpiringUploadBytes,
} from '../../utils/credits';
import { BannerShell } from '../organisms/BannerNotifications/BannerShell';

/**
 * Displays a warning banner when the user has purchased credits that will
 * expire within the next 30 days.  Uses the shared BannerShell for consistent
 * styling with admin-created banners.  Only shown to authenticated users.
 */
export const ExpiryWarningBanner = () => {
  const { api } = useNetwork();
  const session = useContext(SessionContext);

  const { data: expiringBatches } = useQuery<ExpiringCreditBatch[]>({
    queryKey: ['expiringCreditBatches'],
    queryFn: () => api.getExpiringCreditBatches(),
    // Refresh every 5 minutes – expiry warnings don't need to be real-time
    refetchInterval: 5 * 60 * 1000,
    enabled: !!session?.data,
  });

  if (!expiringBatches || expiringBatches.length === 0) return null;

  // Find the soonest expiry date across all expiring batches
  const soonestExpiry = expiringBatches.reduce<Date | null>((acc, batch) => {
    const d = new Date(batch.expiresAt);
    return acc === null || d < acc ? d : acc;
  }, null);

  const daysLeft = daysUntilExpiry(soonestExpiry);

  // Sum remaining bytes across expiring batches (strings from API → BigInt)
  const totalExpiringBytes = sumExpiringUploadBytes(expiringBatches);
  const totalMB = Number(totalExpiringBytes / BigInt(1024 * 1024));

  return (
    <BannerShell criticality={BannerCriticality.Warning}>
      <h3 className='font-semibold text-sm'>Credits expiring soon!</h3>
      <p className='mt-1 text-sm'>
        {totalMB > 0 ? `${totalMB.toFixed(0)} MiB of` : 'Some of your'}{' '}
        purchased storage credits will expire
        {daysLeft !== null && daysLeft > 0
          ? ` in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
          : ' today'}
        . Use them before they expire.
      </p>
    </BannerShell>
  );
};

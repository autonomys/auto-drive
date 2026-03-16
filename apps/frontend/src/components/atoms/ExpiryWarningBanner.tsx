'use client';

import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '../../contexts/network';
import { ExpiringCreditBatch } from '../../services/api';
import { SessionContext } from 'next-auth/react';
import { useContext } from 'react';
import {
  daysUntilExpiry,
  sumExpiringUploadBytes,
} from '../../utils/credits';

/**
 * Displays a dismissable banner when the user has purchased credits that will
 * expire within the next 30 days.  The banner is only shown to authenticated
 * users.
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
    <div className='flex items-center gap-3 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
      <svg
        xmlns='http://www.w3.org/2000/svg'
        viewBox='0 0 20 20'
        fill='currentColor'
        className='h-5 w-5 flex-shrink-0'
        aria-hidden='true'
      >
        <path
          fillRule='evenodd'
          d='M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'
          clipRule='evenodd'
        />
      </svg>
      <span>
        <strong>Credits expiring soon!</strong>{' '}
        {totalMB > 0 ? `${totalMB.toFixed(0)} MiB of` : 'Some of your'}{' '}
        purchased storage credits will expire
        {daysLeft !== null ? ` in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : ' soon'}.
        Use them before they expire.
      </span>
    </div>
  );
};

'use client';

import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '../../../contexts/network';
import { useUserStore } from '../../../globalStates/user';
import { formatBytes } from '../../../utils/number';
import { formatDate } from '../../../utils/time';
import {
  daysUntilExpiry,
  getBatchStatus,
  STATUS_CLASSES,
  STATUS_LABEL,
} from '../../../utils/credits';
import Link from 'next/link';
import { Button } from '@auto-drive/ui';
import { ShoppingCart, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import type { ExpiringCreditBatch } from '../../../services/api';

// ---------------------------------------------------------------------------
// Consumption progress bar
// ---------------------------------------------------------------------------

const ConsumptionBar = ({ batch }: { batch: ExpiringCreditBatch }) => {
  const original = Number(BigInt(batch.uploadBytesOriginal));
  const remaining = Number(BigInt(batch.uploadBytesRemaining));
  const consumed = original - remaining;
  const pct = original > 0 ? Math.round((consumed / original) * 100) : 0;

  return (
    <div className='mt-1 flex flex-col gap-0.5'>
      <div className='h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700'>
        <div
          className='h-full rounded-full bg-blue-500 transition-all'
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className='text-xs text-muted-foreground'>
        {formatBytes(consumed, 1)} used of {formatBytes(original, 1)} ({pct}%)
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Batch card
// ---------------------------------------------------------------------------

const BatchCard = ({ batch }: { batch: ExpiringCreditBatch }) => {
  const status = getBatchStatus(batch);
  const daysLeft =
    !batch.expired ? daysUntilExpiry(new Date(batch.expiresAt)) : null;

  return (
    <div className='rounded-lg border border-border bg-card p-4 shadow-sm'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
            {status === 'expiring' && daysLeft !== null && (
              <span className='text-xs text-amber-600 dark:text-amber-400'>
                {daysLeft === 0 ? 'expires today' : `${daysLeft}d remaining`}
              </span>
            )}
          </div>

          <ConsumptionBar batch={batch} />
        </div>

        <div className='text-right text-sm shrink-0'>
          <p className='font-medium text-foreground'>
            {formatBytes(Number(BigInt(batch.uploadBytesRemaining)), 1)}{' '}
            remaining
          </p>
        </div>
      </div>

      <div className='mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <span>Purchased</span>
        <span className='text-right'>{formatDate(batch.purchasedAt)}</span>
        <span>Expires</span>
        <span className='text-right'>
          {batch.expired ? (
            <span className='text-red-500'>
              Expired {formatDate(batch.expiresAt)}
            </span>
          ) : (
            formatDate(batch.expiresAt)
          )}
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CTA panel — shown when all credits are depleted / expiring soon
// ---------------------------------------------------------------------------

const BuyMoreCta = ({ purchaseHref }: { purchaseHref: string }) => (
  <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20'>
    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
      <div>
        <p className='font-medium text-foreground'>Need more storage?</p>
        <p className='mt-0.5 text-sm text-muted-foreground'>
          Purchase additional credits to keep uploading to the Autonomys
          Network.
        </p>
      </div>
      <Link href={purchaseHref}>
        <Button className='flex shrink-0 items-center gap-2 whitespace-nowrap'>
          <ShoppingCart className='h-4 w-4' />
          Buy more credits
        </Button>
      </Link>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export const CreditHistoryView = () => {
  const { api, network } = useNetwork();
  const { features } = useUserStore();

  // Pay with AI3 is available to both OneOff and Monthly accounts when the
  // `buyCredits` feature flag is on (the flag itself enforces Google-auth and
  // public-rollout state — see core/featureFlags).
  const hasBuyCreditsFeature = !!features.buyCredits;

  const purchaseHref = `/${network.id}/drive/purchase`;

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['creditBatches'],
    queryFn: () => api.getCreditBatches(),
    enabled: hasBuyCreditsFeature,
    staleTime: 30_000,
  });

  // Show CTA when user has no active non-depleted batches or all are expiring
  // within 7 days.
  const showBuyMoreCta = useMemo(() => {
    if (!hasBuyCreditsFeature || isLoading) return false;
    if (batches.length === 0) return true;
    const activeBatches = batches.filter((b: ExpiringCreditBatch) => {
      if (b.expired) return false;
      if (BigInt(b.uploadBytesRemaining) === BigInt(0)) return false;
      const days = daysUntilExpiry(new Date(b.expiresAt));
      return days === null || days > 7;
    });
    return activeBatches.length === 0;
  }, [batches, hasBuyCreditsFeature, isLoading]);

  if (!hasBuyCreditsFeature) {
    return (
      <div className='flex flex-col gap-4'>
        <h1 className='text-2xl font-semibold text-foreground'>
          Credit History
        </h1>
        <p className='text-muted-foreground'>
          Purchased credit history is not currently available.
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold text-foreground'>
          Credit History
        </h1>
        {hasBuyCreditsFeature && (
          <Link href={purchaseHref}>
            <Button variant='outline' className='flex items-center gap-2'>
              <ShoppingCart className='h-4 w-4' />
              Buy credits
            </Button>
          </Link>
        )}
      </div>

      {/* Buy more CTA */}
      {showBuyMoreCta && <BuyMoreCta purchaseHref={purchaseHref} />}

      {/* Batch list */}
      {isLoading ? (
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <RefreshCw className='h-4 w-4 animate-spin' />
          Loading credit history…
        </div>
      ) : batches.length === 0 ? (
        <div className='rounded-lg border border-dashed border-border p-8 text-center'>
          <p className='text-muted-foreground'>No purchases yet.</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            Credit batches will appear here once you complete a purchase.
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          {batches.map((batch: ExpiringCreditBatch) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
        </div>
      )}
    </div>
  );
};

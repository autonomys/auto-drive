'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNetwork } from '../../../contexts/network';
import { formatBytes } from '../../../utils/number';
import { formatDate } from '../../../utils/time';
import { RefreshCw, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import type {
  AdminCreditBatch,
  CreditEconomicsResponse,
  OverCapIntent,
} from '../../../services/api';

// ---------------------------------------------------------------------------
// Batch status helpers (mirrors CreditHistory)
// ---------------------------------------------------------------------------

type BatchStatus = 'active' | 'expiring' | 'depleted' | 'expired';

const getBatchStatus = (batch: AdminCreditBatch): BatchStatus => {
  if (batch.expired) return 'expired';
  if (BigInt(batch.uploadBytesRemaining) === BigInt(0)) return 'depleted';
  const msLeft =
    new Date(batch.expiresAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  if (daysLeft <= 30) return 'expiring';
  return 'active';
};

const STATUS_CLASSES: Record<BatchStatus, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  expiring:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  depleted: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_LABEL: Record<BatchStatus, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  depleted: 'Depleted',
  expired: 'Expired',
};

// ---------------------------------------------------------------------------
// Economics summary card
// ---------------------------------------------------------------------------

const EconomicsCard = ({
  economics,
}: {
  economics: CreditEconomicsResponse;
}) => (
  <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
    <div className='rounded-lg border border-border bg-card p-4'>
      <p className='text-xs text-muted-foreground'>Batches expiring ≤ 30 d</p>
      <p className='mt-1 text-2xl font-semibold text-foreground'>
        {economics.totalExpiringWithin30Days}
      </p>
    </div>
    <div className='rounded-lg border border-border bg-card p-4'>
      <p className='text-xs text-muted-foreground'>Upload bytes expiring</p>
      <p className='mt-1 text-2xl font-semibold text-foreground'>
        {formatBytes(Number(BigInt(economics.totalExpiringUploadBytes)), 1)}
      </p>
    </div>
    <div className='rounded-lg border border-border bg-card p-4'>
      <p className='text-xs text-muted-foreground'>Download bytes expiring</p>
      <p className='mt-1 text-2xl font-semibold text-foreground'>
        {formatBytes(Number(BigInt(economics.totalExpiringDownloadBytes)), 1)}
      </p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// OVER_CAP intents panel
// ---------------------------------------------------------------------------

const OverCapPanel = ({
  intents,
  onReprocess,
  reprocessingId,
  isPending,
}: {
  intents: OverCapIntent[];
  onReprocess: (id: string) => void;
  reprocessingId: string | null;
  isPending: boolean;
}) => {
  if (intents.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        No over-cap intents — all payments resolved.
      </p>
    );
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-border text-left text-xs text-muted-foreground'>
            <th className='pb-2 pr-4 font-medium'>Intent ID</th>
            <th className='pb-2 pr-4 font-medium'>User</th>
            <th className='pb-2 pr-4 font-medium'>Paid (AI3 shannons)</th>
            <th className='pb-2 pr-4 font-medium'>Tx hash</th>
            <th className='pb-2 font-medium'>Action</th>
          </tr>
        </thead>
        <tbody>
          {intents.map((intent) => (
            <tr
              key={intent.id}
              className='border-b border-border last:border-0'
            >
              <td className='py-2 pr-4 font-mono text-xs'>
                {intent.id.slice(0, 12)}…
              </td>
              <td className='py-2 pr-4 font-mono text-xs'>
                {intent.userPublicId.slice(0, 12)}…
              </td>
              <td className='py-2 pr-4'>
                {intent.paymentAmount ?? '—'}
              </td>
              <td className='py-2 pr-4 font-mono text-xs'>
                {intent.txHash
                  ? `${intent.txHash.slice(0, 10)}…`
                  : '—'}
              </td>
              <td className='py-2'>
                <Button
                  variant='outline'
                  disabled={isPending && reprocessingId === intent.id}
                  onClick={() => onReprocess(intent.id)}
                  className='flex items-center gap-1 text-xs'
                >
                  <RotateCcw className='h-3 w-3' />
                  {isPending && reprocessingId === intent.id ? 'Reprocessing…' : 'Reprocess'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
// All credit batches table
// ---------------------------------------------------------------------------

const AllBatchesTable = ({ batches }: { batches: AdminCreditBatch[] }) => {
  if (batches.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        No credit batches have been purchased yet.
      </p>
    );
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-border text-left text-xs text-muted-foreground'>
            <th className='pb-2 pr-4 font-medium'>User</th>
            <th className='pb-2 pr-4 font-medium'>Status</th>
            <th className='pb-2 pr-4 font-medium'>Purchased</th>
            <th className='pb-2 pr-4 font-medium'>Original</th>
            <th className='pb-2 pr-4 font-medium'>Remaining</th>
            <th className='pb-2 pr-4 font-medium'>Used %</th>
            <th className='pb-2 font-medium'>Expires</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => {
            const status = getBatchStatus(batch);
            const original = Number(BigInt(batch.uploadBytesOriginal));
            const remaining = Number(BigInt(batch.uploadBytesRemaining));
            const usedPct =
              original > 0
                ? Math.round(((original - remaining) / original) * 100)
                : 0;

            return (
              <tr
                key={batch.id}
                className='border-b border-border last:border-0'
              >
                <td className='py-2 pr-4 font-mono text-xs'>
                  {batch.userPublicId.slice(0, 14)}…
                </td>
                <td className='py-2 pr-4'>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </td>
                <td className='py-2 pr-4 text-xs'>
                  {formatDate(batch.purchasedAt)}
                </td>
                <td className='py-2 pr-4 text-xs'>
                  {formatBytes(original, 1)}
                </td>
                <td className='py-2 pr-4 text-xs'>
                  {formatBytes(remaining, 1)}
                </td>
                <td className='py-2 pr-4'>
                  <div className='flex items-center gap-2'>
                    <div className='h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700'>
                      <div
                        className='h-full rounded-full bg-blue-500'
                        style={{ width: `${usedPct}%` }}
                      />
                    </div>
                    <span className='text-xs text-muted-foreground'>
                      {usedPct}%
                    </span>
                  </div>
                </td>
                <td className='py-2 text-xs'>
                  {batch.expired ? (
                    <span className='text-red-500'>
                      Expired {formatDate(batch.expiresAt)}
                    </span>
                  ) : (
                    formatDate(batch.expiresAt)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const AdminCredits = () => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();

  const { data: economics, isLoading: economicsLoading } =
    useQuery<CreditEconomicsResponse>({
      queryKey: ['adminCreditEconomics'],
      queryFn: () => api.getCreditEconomics(),
      staleTime: 60_000,
    });

  const { data: batches = [], isLoading: batchesLoading } = useQuery<
    AdminCreditBatch[]
  >({
    queryKey: ['adminCreditBatches'],
    queryFn: () => api.getAdminCreditBatches(),
    staleTime: 60_000,
  });

  const { data: overCapIntents = [], isLoading: overCapLoading } = useQuery<
    OverCapIntent[]
  >({
    queryKey: ['adminOverCapIntents'],
    queryFn: () => api.getOverCapIntents(),
    staleTime: 30_000,
  });

  const { mutate: reprocess, variables: reprocessingId, isPending: isReprocessing } = useMutation<
    void,
    Error,
    string
  >({
    mutationFn: (intentId: string) => api.reprocessIntent(intentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['adminOverCapIntents'] });
      void queryClient.invalidateQueries({ queryKey: ['adminCreditBatches'] });
    },
  });

  const isLoading = economicsLoading || batchesLoading || overCapLoading;

  return (
    <div className='space-y-8'>
      <div className='flex items-center gap-2'>
        <h2 className='text-xl font-semibold'>Purchased Credits</h2>
        {isLoading && (
          <RefreshCw className='h-4 w-4 animate-spin text-muted-foreground' />
        )}
      </div>

      {/* Economics summary */}
      <div>
        <h3 className='mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide'>
          System Economics (expiring ≤ 30 days)
        </h3>
        {economics ? (
          <EconomicsCard economics={economics} />
        ) : (
          !economicsLoading && (
            <p className='text-sm text-muted-foreground'>
              No economics data available.
            </p>
          )
        )}
      </div>

      {/* OVER_CAP intents */}
      <div>
        <div className='mb-3 flex items-center gap-2'>
          <h3 className='text-sm font-medium text-muted-foreground uppercase tracking-wide'>
            Over-Cap Intents
          </h3>
          {overCapIntents.length > 0 && (
            <span className='inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400'>
              <AlertTriangle className='h-3 w-3' />
              {overCapIntents.length} need review
            </span>
          )}
        </div>
        <p className='mb-3 text-xs text-muted-foreground'>
          Payments confirmed on-chain that could not be converted to credits
          because the user hit the per-user cap. Raise the cap via the account
          editor, then click Reprocess to retry.
        </p>
        <OverCapPanel
          intents={overCapIntents}
          onReprocess={(id) => reprocess(id)}
          reprocessingId={reprocessingId ?? null}
          isPending={isReprocessing}
        />
      </div>

      {/* All batches table */}
      <div>
        <h3 className='mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide'>
          All Purchase Batches ({batches.length})
        </h3>
        <AllBatchesTable batches={batches} />
      </div>
    </div>
  );
};

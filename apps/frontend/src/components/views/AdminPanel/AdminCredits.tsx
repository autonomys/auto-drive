'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNetwork } from '../../../contexts/network';
import { formatBytes } from '../../../utils/number';
import { formatDate } from '../../../utils/time';
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button, ROUTES, type NetworkId } from '@auto-drive/ui';
import {
  getBatchStatus,
  STATUS_CLASSES,
  STATUS_LABEL,
} from '../../../utils/credits';
import type {
  AdminCreditBatch,
  CreditEconomicsResponse,
  OverCapIntent,
} from '../../../services/api';
import Link from 'next/link';

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
// Per-account batch group
// Top-level grouping is by `batch.accountId` — the org-level storage
// account that credits belong to; several users of the same organization
// can each purchase credits for it, so grouping by user would split one
// account into multiple summary lines with incorrect totals.
// Within an account, batches can have been paid from different purchasing
// wallets (the intent's fromAddress). Refunds are batched per
// (account, purchasing wallet) pair — one refund transfer goes back to one
// wallet — so the expanded list is sorted by purchasing wallet and shows it
// per row; the actual refund selection happens on the per-user screen,
// which enforces the same pairing.
// Each group renders as a single collapsed summary line (batch count,
// users / wallets involved, purchased / remaining / expired storage).
// ---------------------------------------------------------------------------

type AccountBatchGroup = {
  /** batch.accountId — the org-level storage account. */
  accountId: string;
  batches: AdminCreditBatch[];
  /** Distinct publicIds of the users who purchased for this account. */
  userPublicIds: string[];
  /** Distinct purchasing wallets (fromAddress) across the batches. */
  walletCount: number;
  refundableCount: number;
  refundedCount: number;
  /** Σ upload_bytes_original across all batches. */
  totalPurchased: number;
  /** Σ upload_bytes_remaining across non-expired batches (still usable). */
  totalRemaining: number;
  /** Σ upload_bytes_remaining across expired batches (forfeited unused). */
  totalExpiredUnused: number;
};

const groupBatchesByAccount = (
  batches: AdminCreditBatch[],
): AccountBatchGroup[] => {
  const groups = new Map<string, AdminCreditBatch[]>();
  for (const batch of batches) {
    const existing = groups.get(batch.accountId);
    if (existing) {
      existing.push(batch);
    } else {
      groups.set(batch.accountId, [batch]);
    }
  }

  return [...groups.entries()].map(([accountId, accountBatches]) => ({
    accountId,
    // Sort by purchasing wallet so batches that can be refunded together
    // (same account + same wallet) are adjacent, newest first within each.
    batches: [...accountBatches].sort(
      (a, b) =>
        (a.fromAddress ?? '').localeCompare(b.fromAddress ?? '') ||
        new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime(),
    ),
    userPublicIds: [...new Set(accountBatches.map((b) => b.userPublicId))],
    walletCount: new Set(accountBatches.map((b) => b.fromAddress ?? '—')).size,
    // Awaiting refund = expired with unused bytes left. Fully depleted
    // batches (0 remaining) forfeited nothing, so no refund is owed —
    // require remaining > 0 as defence in depth against stale expired flags.
    refundableCount: accountBatches.filter(
      (b) =>
        b.expired &&
        b.refundedAt === null &&
        BigInt(b.uploadBytesRemaining) + BigInt(b.downloadBytesRemaining) >
          BigInt(0),
    ).length,
    refundedCount: accountBatches.filter((b) => b.refundedAt !== null).length,
    totalPurchased: accountBatches.reduce(
      (s, b) => s + Number(BigInt(b.uploadBytesOriginal)),
      0,
    ),
    totalRemaining: accountBatches.reduce(
      (s, b) =>
        s + (b.expired ? 0 : Number(BigInt(b.uploadBytesRemaining))),
      0,
    ),
    totalExpiredUnused: accountBatches.reduce(
      (s, b) =>
        s + (b.expired ? Number(BigInt(b.uploadBytesRemaining)) : 0),
      0,
    ),
  }));
};

const AccountBatchGroupSection = ({
  group,
  networkId,
  isExpanded,
  onToggle,
}: {
  group: AccountBatchGroup;
  networkId: NetworkId;
  isExpanded: boolean;
  onToggle: () => void;
}) => (
  <div className='rounded-lg border border-border'>
    {/* Single-line purchasing wallet summary — chevron expands the list. */}
    <div
      className={`flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-3 ${
        isExpanded ? 'border-b border-border' : ''
      }`}
    >
      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded ? 'Hide batches for account' : 'Show batches for account'
          }
          className='text-muted-foreground hover:text-foreground'
        >
          {isExpanded ? (
            <ChevronDown className='h-4 w-4' />
          ) : (
            <ChevronRight className='h-4 w-4' />
          )}
        </button>
        <Link
          href={ROUTES.adminOrganization(networkId, group.accountId)}
          className='font-mono text-xs text-blue-500 hover:underline'
          title={`Account ${group.accountId} — uploads and downloads`}
        >
          {group.accountId.slice(0, 20)}…
        </Link>
        <span className='text-xs text-muted-foreground'>
          {group.batches.length}{' '}
          {group.batches.length === 1 ? 'batch' : 'batches'}
          {group.userPublicIds.length > 1 &&
            ` (${group.userPublicIds.length} users)`}
          {group.walletCount > 1 && ` (${group.walletCount} wallets)`}{' '}
          · {formatBytes(group.totalPurchased, 1)} purchased ·{' '}
          {formatBytes(group.totalRemaining, 1)} remaining ·{' '}
          <span
            className={group.totalExpiredUnused > 0 ? 'text-red-500' : ''}
          >
            {formatBytes(group.totalExpiredUnused, 1)} expired
          </span>
        </span>
        {group.refundableCount > 0 && (
          <span className='inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'>
            <AlertTriangle className='h-3 w-3' />
            {group.refundableCount} awaiting refund
          </span>
        )}
      </div>
      <div className='flex items-center gap-3'>
        {group.userPublicIds.length === 1 ? (
          <Link
            href={ROUTES.adminUserCredits(networkId, group.userPublicIds[0])}
            className='text-xs text-blue-500 hover:underline'
          >
            {group.refundableCount > 0 ? 'Process refunds →' : 'View details →'}
          </Link>
        ) : (
          <span className='text-xs text-muted-foreground'>
            Expand to pick a user
          </span>
        )}
      </div>
    </div>

    {/* Batch rows — hidden until the admin expands the account. Sorted by
        purchasing wallet so refundable-together batches are adjacent. */}
    {isExpanded && (
    <div className='overflow-x-auto'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-border text-left text-xs text-muted-foreground'>
            <th className='px-4 py-2 font-medium'>User</th>
            <th className='px-4 py-2 font-medium'>Purchasing Wallet</th>
            <th className='px-4 py-2 font-medium'>Status</th>
            <th className='px-4 py-2 font-medium'>Purchased</th>
            <th className='px-4 py-2 font-medium'>Original</th>
            <th className='px-4 py-2 font-medium'>Remaining</th>
            <th className='px-4 py-2 font-medium'>Used %</th>
            <th className='px-4 py-2 font-medium'>Expires</th>
            <th className='px-4 py-2 font-medium'>Refund</th>
          </tr>
        </thead>
        <tbody>
          {group.batches.map((batch) => {
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
                <td className='px-4 py-2 font-mono text-xs'>
                  <Link
                    href={ROUTES.adminUserCredits(
                      networkId,
                      batch.userPublicId,
                    )}
                    className='text-blue-500 hover:underline'
                    title={batch.userPublicId}
                  >
                    {batch.userPublicId.slice(0, 12)}…
                  </Link>
                </td>
                <td className='px-4 py-2 font-mono text-xs'>
                  {batch.fromAddress ? (
                    <span title={batch.fromAddress}>
                      {batch.fromAddress.slice(0, 8)}…
                      {batch.fromAddress.slice(-6)}
                    </span>
                  ) : (
                    <span className='text-muted-foreground'>—</span>
                  )}
                </td>
                <td className='px-4 py-2'>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </td>
                <td className='px-4 py-2 text-xs'>
                  {formatDate(batch.purchasedAt)}
                </td>
                <td className='px-4 py-2 text-xs'>
                  {formatBytes(original, 1)}
                </td>
                <td className='px-4 py-2 text-xs'>
                  {formatBytes(remaining, 1)}
                </td>
                <td className='px-4 py-2'>
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
                <td className='px-4 py-2 text-xs'>
                  {batch.expired ? (
                    <span className='text-red-500'>
                      Expired {formatDate(batch.expiresAt)}
                    </span>
                  ) : (
                    formatDate(batch.expiresAt)
                  )}
                </td>
                <td className='px-4 py-2 text-xs'>
                  {batch.refundedAt !== null ? (
                    <span
                      className='inline-flex items-center gap-1 text-muted-foreground'
                      title={batch.refundTxHash ?? undefined}
                    >
                      <CheckCircle2 className='h-3 w-3 text-green-500' />
                      {formatDate(batch.refundedAt)}
                      {batch.refundTxHash && (
                        <span className='font-mono'>
                          · {batch.refundTxHash.slice(0, 10)}…
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className='text-muted-foreground'>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Main component — dedicated admin screen for all purchased credits.
// Rendered at /{chainId}/drive/admin/credits.
// ---------------------------------------------------------------------------

export const AdminCredits = () => {
  const { api, network } = useNetwork();
  const queryClient = useQueryClient();

  // Accounts whose full batch list is currently expanded. Collapsed by
  // default so the screen shows one summary line per account.
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<string>>(
    new Set(),
  );

  const toggleExpanded = (accountId: string) => {
    setExpandedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

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

  const groups = useMemo(
    () => groupBatchesByAccount(batches),
    [batches],
  );
  const awaitingRefund = useMemo(
    () => groups.reduce((s, g) => s + g.refundableCount, 0),
    [groups],
  );

  const isLoading = economicsLoading || batchesLoading || overCapLoading;

  return (
    <div className='space-y-8 p-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <Link
          href={ROUTES.admin(network.id)}
          className='text-muted-foreground hover:text-foreground'
        >
          <ArrowLeft className='h-5 w-5' />
        </Link>
        <div>
          <h1 className='text-2xl font-bold'>Purchased Credits</h1>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            All credit batches across all users, grouped by account. Refunds
            are processed per account and purchasing wallet.
          </p>
        </div>
        {isLoading && (
          <RefreshCw className='ml-auto h-4 w-4 animate-spin text-muted-foreground' />
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

      {/* All batches grouped by user */}
      <div>
        <div className='mb-3 flex items-center gap-2'>
          <h3 className='text-sm font-medium text-muted-foreground uppercase tracking-wide'>
            All Purchase Batches ({batches.length})
          </h3>
          {awaitingRefund > 0 && (
            <span className='inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'>
              <AlertTriangle className='h-3 w-3' />
              {awaitingRefund} expired awaiting refund
            </span>
          )}
          {groups.length > 0 && (
            <button
              type='button'
              onClick={() =>
                setExpandedAccountIds(
                  expandedAccountIds.size === groups.length
                    ? new Set()
                    : new Set(groups.map((g) => g.accountId)),
                )
              }
              className='ml-auto text-xs text-blue-500 hover:underline'
            >
              {expandedAccountIds.size === groups.length
                ? 'Collapse all'
                : 'Expand all'}
            </button>
          )}
        </div>
        {groups.length === 0 ? (
          !batchesLoading && (
            <p className='text-sm text-muted-foreground'>
              No credit batches have been purchased yet.
            </p>
          )
        ) : (
          <div className='space-y-3'>
            {groups.map((group) => (
              <AccountBatchGroupSection
                key={group.accountId}
                group={group}
                networkId={network.id}
                isExpanded={expandedAccountIds.has(group.accountId)}
                onToggle={() => toggleExpanded(group.accountId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

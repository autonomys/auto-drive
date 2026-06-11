'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNetwork } from '../../../contexts/network';
import { formatBytes } from '../../../utils/number';
import { formatDate } from '../../../utils/time';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { Button, ROUTES } from '@auto-drive/ui';
import { getBatchStatus, STATUS_CLASSES, STATUS_LABEL } from '../../../utils/credits';
import type { AdminUserCreditBatch } from '../../../services/api';
import Link from 'next/link';
import { shannonsToAi3 } from '@autonomys/auto-utils';
import { RefundTxHashModal } from './RefundTxHashModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a raw shannons string (from the wire API) as a human-readable AI3
 * amount, e.g. "1.234567 AI3".  Uses the canonical SDK converter which
 * handles the 1e18 shannons-per-AI3 conversion with proper precision.
 */
const formatAI3Paid = (paymentAmount: string | null): string => {
  if (!paymentAmount) return '—';
  try {
    return `${shannonsToAi3(BigInt(paymentAmount), { trimTrailingZeros: true })} AI3`;
  } catch {
    return '—';
  }
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const AdminUserCredits = ({
  userPublicId,
}: {
  userPublicId: string;
}) => {
  const { api, network } = useNetwork();
  const queryClient = useQueryClient();

  // Ids of the batches the admin has ticked for a combined refund.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Batches currently being confirmed in the tx-hash modal (null = closed).
  const [refundTarget, setRefundTarget] = useState<string[] | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);

  const queryKey = ['adminUserCreditBatches', userPublicId];

  const { data: batches = [], isLoading } = useQuery<AdminUserCreditBatch[]>({
    queryKey,
    queryFn: () => api.getUserCreditBatches(userPublicId),
    staleTime: 30_000,
  });

  // Batches are loaded by userPublicId, so they can span more than one
  // account when the user purchased credits under different org accounts
  // over time. Each distinct account links to the existing account
  // (organization) page with the uploads/downloads history.
  const accountIds = useMemo(
    () => [...new Set(batches.map((b) => b.accountId))],
    [batches],
  );
  const hasMultipleAccounts = accountIds.length > 1;

  // A batch can be selected for refund as long as it has not been refunded
  // yet. Several unused batches of the SAME account can be ticked and
  // processed together with a single on-chain transaction hash — the
  // backend rejects combined refunds that span accounts, so the first
  // selected batch anchors the account and batches of other accounts are
  // disabled until the selection is cleared.
  const refundableIds = useMemo(
    () => new Set(batches.filter((b) => b.refundedAt === null).map((b) => b.id)),
    [batches],
  );

  const selectedRefundableIds = useMemo(
    () => [...selectedIds].filter((id) => refundableIds.has(id)),
    [selectedIds, refundableIds],
  );

  // Account of the current selection (all selected batches share it).
  const selectedAccountId = useMemo(() => {
    const firstSelected = batches.find((b) => selectedIds.has(b.id));
    return firstSelected?.accountId ?? null;
  }, [batches, selectedIds]);

  const isSelectable = (batch: AdminUserCreditBatch): boolean =>
    batch.refundedAt === null &&
    (selectedAccountId === null || batch.accountId === selectedAccountId);

  // Select-all targets a single account: the selection's account, or — when
  // nothing is selected — the first account that has refundable batches.
  const selectAllAccountId = useMemo(() => {
    if (selectedAccountId) return selectedAccountId;
    return (
      batches.find((b) => refundableIds.has(b.id))?.accountId ?? null
    );
  }, [selectedAccountId, batches, refundableIds]);

  const selectAllTargetIds = useMemo(
    () =>
      batches
        .filter(
          (b) => refundableIds.has(b.id) && b.accountId === selectAllAccountId,
        )
        .map((b) => b.id),
    [batches, refundableIds, selectAllAccountId],
  );

  const allSelected =
    selectAllTargetIds.length > 0 &&
    selectAllTargetIds.every((id) => selectedIds.has(id));

  const toggleSelected = (batchId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectAllTargetIds));
  };

  const { mutate: refund, isPending: isRefunding } = useMutation<
    unknown,
    Error,
    { batchIds: string[]; refundTxHash: string }
  >({
    mutationFn: ({ batchIds, refundTxHash }) =>
      api.refundCreditBatches(batchIds, refundTxHash),
    onSuccess: () => {
      setRefundTarget(null);
      setRefundError(null);
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ['adminCreditBatches'] });
    },
    onError: (error) => {
      setRefundError(error.message);
    },
  });

  const openRefundModal = (batchIds: string[]) => {
    setRefundError(null);
    setRefundTarget(batchIds);
  };

  return (
    <div className='space-y-6 p-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <Link
          href={ROUTES.adminCredits(network.id)}
          className='text-muted-foreground hover:text-foreground'
        >
          <ArrowLeft className='h-5 w-5' />
        </Link>
        <div>
          <h1 className='text-xl font-semibold'>Purchase History</h1>
          <p
            className='mt-0.5 font-mono text-xs text-muted-foreground break-all'
            title={userPublicId}
          >
            {userPublicId}
          </p>
          {accountIds.map((accountId) => (
            <Link
              key={accountId}
              href={ROUTES.adminOrganization(network.id, accountId)}
              className='mt-1 flex w-fit items-center gap-1 font-mono text-xs text-blue-500 hover:underline'
              title={`View account ${accountId} — uploads and downloads`}
            >
              Account: {accountId}
              <ExternalLink className='h-3 w-3' />
            </Link>
          ))}
        </div>
        {isLoading && (
          <RefreshCw className='ml-auto h-4 w-4 animate-spin text-muted-foreground' />
        )}
      </div>

      {/* Summary row */}
      {batches.length > 0 && (
        <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <div className='rounded-lg border border-border bg-card p-4'>
            <p className='text-xs text-muted-foreground'>Total batches</p>
            <p className='mt-1 text-2xl font-semibold'>{batches.length}</p>
          </div>
          <div className='rounded-lg border border-border bg-card p-4'>
            <p className='text-xs text-muted-foreground'>Total purchased</p>
            <p className='mt-1 text-2xl font-semibold'>
              {formatBytes(
                batches.reduce(
                  (s, b) => s + Number(BigInt(b.uploadBytesOriginal)),
                  0,
                ),
                1,
              )}
            </p>
          </div>
          <div className='rounded-lg border border-border bg-card p-4'>
            <p className='text-xs text-muted-foreground'>Remaining</p>
            <p className='mt-1 text-2xl font-semibold'>
              {formatBytes(
                batches.reduce(
                  (s, b) => s + Number(BigInt(b.uploadBytesRemaining)),
                  0,
                ),
                1,
              )}
            </p>
          </div>
          <div className='rounded-lg border border-border bg-card p-4'>
            <p className='text-xs text-muted-foreground'>Refunded</p>
            <p className='mt-1 text-2xl font-semibold'>
              {batches.filter((b) => b.refundedAt !== null).length}
            </p>
          </div>
        </div>
      )}

      {/* Combined refund action bar */}
      {selectedRefundableIds.length > 0 && (
        <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-900/20'>
          <p className='text-sm text-amber-800 dark:text-amber-300'>
            {selectedRefundableIds.length}{' '}
            {selectedRefundableIds.length === 1 ? 'batch' : 'batches'} selected
            {hasMultipleAccounts && selectedAccountId && (
              <span className='font-mono'>
                {' '}
                (account {selectedAccountId.slice(0, 8)}…)
              </span>
            )}{' '}
            — one transaction hash will be recorded on all of them.
          </p>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              onClick={() => setSelectedIds(new Set())}
              className='text-xs'
            >
              Clear
            </Button>
            <Button
              variant='primary'
              onClick={() => openRefundModal(selectedRefundableIds)}
              className='flex items-center gap-1 text-xs'
            >
              <AlertTriangle className='h-3 w-3' />
              Mark {selectedRefundableIds.length} Refunded
            </Button>
          </div>
        </div>
      )}

      {/* Batches table */}
      {batches.length === 0 && !isLoading ? (
        <p className='text-sm text-muted-foreground'>
          No credit batches found for this user.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-lg border border-border'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-border bg-muted/50 text-left text-xs text-muted-foreground'>
                <th className='px-4 py-3 font-medium'>
                  <input
                    type='checkbox'
                    aria-label='Select all refundable batches of the account'
                    title={
                      hasMultipleAccounts && selectAllAccountId
                        ? `Selects refundable batches of account ${selectAllAccountId} only — combined refunds cannot span accounts`
                        : undefined
                    }
                    checked={allSelected}
                    disabled={selectAllTargetIds.length === 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                {hasMultipleAccounts && (
                  <th className='px-4 py-3 font-medium'>Account</th>
                )}
                <th className='px-4 py-3 font-medium'>Date</th>
                <th className='px-4 py-3 font-medium'>Status</th>
                <th className='px-4 py-3 font-medium'>Expires</th>
                <th className='px-4 py-3 font-medium'>Original</th>
                <th className='px-4 py-3 font-medium'>Consumed</th>
                <th className='px-4 py-3 font-medium'>Remaining</th>
                <th className='px-4 py-3 font-medium'>AI3 Paid</th>
                <th className='px-4 py-3 font-medium'>EVM Wallet</th>
                <th className='px-4 py-3 font-medium'>Refund</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => {
                const status = getBatchStatus(batch);
                const original = Number(BigInt(batch.uploadBytesOriginal));
                const remaining = Number(BigInt(batch.uploadBytesRemaining));
                const consumed = original - remaining;
                const isRefundable = batch.refundedAt === null;
                const isOtherAccount =
                  isRefundable && !isSelectable(batch);

                return (
                  <tr
                    key={batch.id}
                    className='border-b border-border last:border-0 hover:bg-muted/30'
                  >
                    {/* Selection */}
                    <td className='px-4 py-3'>
                      <input
                        type='checkbox'
                        aria-label='Select batch for refund'
                        title={
                          isOtherAccount
                            ? 'Belongs to a different account than the current selection — combined refunds cannot span accounts'
                            : undefined
                        }
                        checked={selectedIds.has(batch.id)}
                        disabled={!isSelectable(batch)}
                        onChange={() => toggleSelected(batch.id)}
                      />
                    </td>

                    {/* Account (only when batches span several accounts) */}
                    {hasMultipleAccounts && (
                      <td className='px-4 py-3 font-mono text-xs'>
                        <Link
                          href={ROUTES.adminOrganization(
                            network.id,
                            batch.accountId,
                          )}
                          className='text-blue-500 hover:underline'
                          title={batch.accountId}
                        >
                          {batch.accountId.slice(0, 8)}…
                        </Link>
                      </td>
                    )}

                    {/* Date */}
                    <td className='px-4 py-3 text-xs'>
                      {formatDate(batch.purchasedAt)}
                    </td>

                    {/* Status */}
                    <td className='px-4 py-3'>
                      <div className='flex flex-col gap-1'>
                        <span
                          className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                        {batch.refundedAt !== null && (
                          <span className='inline-flex w-fit items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
                            <CheckCircle2 className='h-3 w-3' />
                            Refunded
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Expires */}
                    <td className='px-4 py-3 text-xs'>
                      {batch.expired ? (
                        <span className='text-red-500'>
                          {formatDate(batch.expiresAt)}
                        </span>
                      ) : (
                        formatDate(batch.expiresAt)
                      )}
                    </td>

                    {/* Original */}
                    <td className='px-4 py-3 text-xs'>
                      {formatBytes(original, 1)}
                    </td>

                    {/* Consumed */}
                    <td className='px-4 py-3 text-xs'>
                      {formatBytes(consumed, 1)}
                    </td>

                    {/* Remaining */}
                    <td className='px-4 py-3 text-xs'>
                      {formatBytes(remaining, 1)}
                    </td>

                    {/* AI3 paid */}
                    <td className='px-4 py-3 text-xs font-mono'>
                      {formatAI3Paid(batch.paymentAmount)}
                    </td>

                    {/* EVM wallet */}
                    <td className='px-4 py-3 font-mono text-xs'>
                      {batch.fromAddress ? (
                        <span title={batch.fromAddress}>
                          {batch.fromAddress.slice(0, 8)}…
                          {batch.fromAddress.slice(-6)}
                        </span>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </td>

                    {/* Refund action / record */}
                    <td className='px-4 py-3'>
                      {batch.refundedAt !== null ? (
                        <div className='flex flex-col gap-0.5 text-xs text-muted-foreground'>
                          <span>{formatDate(batch.refundedAt)}</span>
                          {batch.refundTxHash && (
                            <span
                              className='font-mono'
                              title={batch.refundTxHash}
                            >
                              {batch.refundTxHash.slice(0, 10)}…
                              {batch.refundTxHash.slice(-6)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <Button
                          variant='outline'
                          disabled={isRefunding}
                          onClick={() => openRefundModal([batch.id])}
                          className='flex items-center gap-1 text-xs'
                        >
                          <AlertTriangle className='h-3 w-3 text-orange-500' />
                          Mark Refunded
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Refund confirmation modal — the transaction hash is mandatory. */}
      {refundTarget !== null && (
        <RefundTxHashModal
          batchCount={refundTarget.length}
          isSubmitting={isRefunding}
          errorMessage={refundError}
          onConfirm={(refundTxHash) =>
            refund({ batchIds: refundTarget, refundTxHash })
          }
          onClose={() => {
            if (!isRefunding) {
              setRefundTarget(null);
              setRefundError(null);
            }
          }}
        />
      )}
    </div>
  );
};

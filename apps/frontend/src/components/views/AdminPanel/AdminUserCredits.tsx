'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNetwork } from '../../../contexts/network';
import { formatBytes } from '../../../utils/number';
import { formatDate } from '../../../utils/time';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Button, ROUTES } from '@auto-drive/ui';
import { getBatchStatus, STATUS_CLASSES, STATUS_LABEL } from '../../../utils/credits';
import type { AdminUserCreditBatch } from '../../../services/api';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert (paymentAmount shannons) / (shannonsPerByte) / (1e18 shannons per AI3)
 * into a human-readable AI3 amount.
 *
 * paymentAmount   — total shannons sent on-chain
 * shannonsPerByte — price per byte in shannons at the time of purchase
 *
 * creditBytes     = paymentAmount / shannonsPerByte  (integer division)
 * AI3 paid        = paymentAmount / 1e18
 */
const SHANNONS_PER_AI3 = BigInt('1000000000000000000') // 1e18

const formatAI3Paid = (paymentAmount: string | null): string => {
  if (!paymentAmount) return '—';
  try {
    const shannons = BigInt(paymentAmount);
    // Format to 6 decimal places
    const whole = shannons / SHANNONS_PER_AI3;
    const remainder = shannons % SHANNONS_PER_AI3;
    const decimals = remainder
      .toString()
      .padStart(18, '0')
      .slice(0, 6)
      .replace(/0+$/, '');
    return decimals ? `${whole}.${decimals} AI3` : `${whole} AI3`;
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
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const queryKey = ['adminUserCreditBatches', userPublicId];

  const { data: batches = [], isLoading } = useQuery<AdminUserCreditBatch[]>({
    queryKey,
    queryFn: () => api.getUserCreditBatches(userPublicId),
    staleTime: 30_000,
  });

  const { mutate: refund, isPending: isRefunding } = useMutation<
    void,
    Error,
    string
  >({
    mutationFn: async (batchId: string) => {
      setRefundingId(batchId);
      return api.refundCreditBatch(batchId);
    },
    onSettled: () => {
      setRefundingId(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <div className='space-y-6 p-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <Link
          href={ROUTES.admin(network.id)}
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
              {batches.filter((b) => b.refunded).length}
            </p>
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

                return (
                  <tr
                    key={batch.id}
                    className='border-b border-border last:border-0 hover:bg-muted/30'
                  >
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
                        {batch.refunded && (
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

                    {/* Refund action */}
                    <td className='px-4 py-3'>
                      {batch.refunded ? (
                        <span className='text-xs text-muted-foreground'>
                          {batch.refundedAt
                            ? formatDate(batch.refundedAt)
                            : 'Refunded'}
                        </span>
                      ) : (
                        <Button
                          variant='outline'
                          disabled={isRefunding && refundingId === batch.id}
                          onClick={() => refund(batch.id)}
                          className='flex items-center gap-1 text-xs'
                        >
                          <AlertTriangle className='h-3 w-3 text-orange-500' />
                          {isRefunding && refundingId === batch.id
                            ? 'Marking…'
                            : 'Mark Refunded'}
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
    </div>
  );
};

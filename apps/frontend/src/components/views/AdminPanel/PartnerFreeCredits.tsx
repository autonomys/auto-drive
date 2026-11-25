'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Loader } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import { AdminAccountDetails } from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { formatStorageSize } from '@/utils/number';
import { formatDate } from '@/utils/time';
import {
  describeBatchKind,
  getBatchStatus,
  STATUS_CLASSES,
  STATUS_LABEL,
} from '@/utils/credits';
import { Table } from '@/components/molecules/Table';
import {
  TableHead,
  TableHeadCell,
  TableHeadRow,
} from '@/components/molecules/Table/TableHead';
import {
  TableBody,
  TableBodyCell,
  TableBodyRow,
} from '@/components/molecules/Table/TableBody';
import { CopiableText } from '@/components/atoms/CopiableText';
import { ByteAmountInput } from '@/components/molecules/ByteAmountInput';
import { amountToBytes, ByteUnit } from '@/utils/byteUnits';
import { AdminDialog } from './PartnerTerms';

const DAY = 24 * 60 * 60 * 1000;

const GrantModal = ({
  account,
  onClose,
  onGranted,
}: {
  account: AdminAccountDetails;
  onClose: () => void;
  onGranted: () => void;
}) => {
  const { api } = useNetwork();
  const [amount, setAmount] = useState({ amount: '', unit: 'GB' as ByteUnit });
  const [expiryDays, setExpiryDays] = useState(
    String(
      account.creditExpiryDays ?? account.defaultCreditTerms.creditExpiryDays,
    ),
  );
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  const uploadBytes = amountToBytes(amount.amount, amount.unit) ?? 0;
  const days = Number(expiryDays);
  const valid =
    uploadBytes > 0 &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= 36500 &&
    reason.trim() !== '';

  const { mutate: grant, isPending } = useMutation({
    mutationFn: () =>
      api.grantFreeCredits(account.id, {
        uploadBytes,
        expiresInDays: days,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Free credits granted');
      onGranted();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const inputClass =
    'w-full rounded border border-border bg-background px-2 py-1 text-foreground';

  return (
    <AdminDialog
      title={
        confirming ? 'Confirm free credits' : 'Grant one-time free credits'
      }
      onClose={onClose}
    >
      {confirming ? (
        <div className='mt-4 space-y-4 text-sm text-foreground'>
          <p>
            Grant <strong>{formatStorageSize(uploadBytes)}</strong> of one-time
            free upload credits, expiring on{' '}
            <strong>
              {formatDate(new Date(Date.now() + days * DAY).toISOString())}
            </strong>
            ?
          </p>
          <p className='text-gray-500'>
            They are used before purchased credits and cannot be refunded or
            taken back here.
          </p>
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Back
            </Button>
            <Button
              variant='primary'
              disabled={isPending}
              onClick={() => grant()}
            >
              {isPending ? 'Granting…' : 'Grant'}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className='mt-4 space-y-4'
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setConfirming(true);
          }}
        >
          <ByteAmountInput
            label='Amount'
            amount={amount.amount}
            unit={amount.unit}
            onChange={setAmount}
          />
          <label className='block text-sm text-foreground'>
            Expires after (days)
            <input
              type='text'
              className={inputClass}
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
          </label>
          <label className='block text-sm text-foreground'>
            Reason
            <input
              type='text'
              className={inputClass}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className='flex justify-end'>
            <Button type='submit' variant='primary' disabled={!valid}>
              Continue
            </Button>
          </div>
        </form>
      )}
    </AdminDialog>
  );
};

/**
 * A partner account's free credits: its monthly batches and one-time grants,
 * with who granted each and why.
 */
export const PartnerFreeCredits = ({
  account,
  onChanged,
}: {
  account: AdminAccountDetails;
  onChanged: () => void;
}) => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();
  const [granting, setGranting] = useState(false);

  const creditsKey = ['adminAccountFreeCredits', account.id];
  const {
    data: credits,
    isLoading,
    isError,
  } = useQuery({
    // Reloaded with an account whose monthly term changed: loading it issued
    // this month's batch if there was none.
    queryKey: [...creditsKey, account.monthlyFreeUploadBytes],
    queryFn: () => api.getAccountFreeCredits(account.id),
  });

  return (
    <div className='rounded-lg border border-gray-200 bg-background p-6'>
      <div className='mb-2 flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-lg font-semibold'>
          <Gift className='h-5 w-5' />
          Free Credits
        </h2>
        <Button variant='lightAccent' onClick={() => setGranting(true)}>
          Grant one-time credits
        </Button>
      </div>
      <p className='mb-4 text-sm text-gray-500'>
        Newest first. Monthly free credits are issued from the terms; one-time
        credits are granted here or when saving one-off terms. Free credits are
        used before purchased ones. The usage report below explains each change.
      </p>
      {isLoading ? (
        <div className='flex items-center justify-center py-4'>
          <Loader className='h-5 w-5 animate-spin' />
        </div>
      ) : isError ? (
        <p className='text-sm text-gray-500'>Free credits are unavailable.</p>
      ) : (
        <div className='overflow-x-auto rounded-lg border border-gray-200'>
          <Table className='min-w-full'>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Granted</TableHeadCell>
                <TableHeadCell>Kind</TableHeadCell>
                <TableHeadCell>By</TableHeadCell>
                <TableHeadCell>Reason</TableHeadCell>
                <TableHeadCell>Bytes</TableHeadCell>
                <TableHeadCell>Remaining</TableHeadCell>
                <TableHeadCell>Expires</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {credits?.map((credit) => {
                const status = getBatchStatus(credit);
                return (
                  <TableBodyRow key={credit.id}>
                    <TableBodyCell>
                      {formatDate(credit.purchasedAt)}
                    </TableBodyCell>
                    <TableBodyCell>{describeBatchKind(credit)}</TableBodyCell>
                    <TableBodyCell>
                      {credit.grantedBy ? (
                        <CopiableText
                          text={credit.grantedBy}
                          className='break-all font-mono text-sm'
                        />
                      ) : (
                        'Monthly terms'
                      )}
                    </TableBodyCell>
                    <TableBodyCell>{credit.grantReason ?? '—'}</TableBodyCell>
                    <TableBodyCell>
                      {formatStorageSize(Number(credit.uploadBytesOriginal))}
                    </TableBodyCell>
                    <TableBodyCell>
                      {status === 'replaced' ? (
                        // Not usable any more: it ended with this left.
                        <span className='text-gray-500'>
                          0 (
                          {formatStorageSize(
                            Number(credit.uploadBytesRemaining),
                          )}{' '}
                          ended)
                        </span>
                      ) : (
                        formatStorageSize(Number(credit.uploadBytesRemaining))
                      )}
                    </TableBodyCell>
                    <TableBodyCell>
                      {formatDate(credit.expiresAt)}
                    </TableBodyCell>
                    <TableBodyCell>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
                        title={
                          status === 'replaced' && credit.supersededAt
                            ? `Ended ${formatDate(credit.supersededAt)}, when the monthly amount changed. A batch for the rest of the month took its place.`
                            : undefined
                        }
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </TableBodyCell>
                  </TableBodyRow>
                );
              })}
              {credits?.length === 0 && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={8}
                    className='py-6 text-center text-gray-500'
                  >
                    No free credits yet
                  </TableBodyCell>
                </TableBodyRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Remounted per opening so the form starts empty. */}
      {granting && (
        <GrantModal
          account={account}
          onClose={() => setGranting(false)}
          onGranted={() => {
            queryClient.invalidateQueries({ queryKey: creditsKey });
            onChanged();
          }}
        />
      )}
    </div>
  );
};

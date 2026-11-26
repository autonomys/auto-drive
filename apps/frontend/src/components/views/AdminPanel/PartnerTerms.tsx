'use client';

import { Fragment, ReactNode, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { FileText, History, Loader } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import {
  AccountModel,
  AccountTermsChange,
  AdminAccountDetails,
} from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { formatStorageSize } from '@/utils/number';
import { formatDate } from '@/utils/time';
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
import { amountToBytes, bytesToAmount, ByteUnit } from '@/utils/byteUnits';

const FIELD_LABEL = new Map([
  ['max_purchased_bytes', 'Max purchased credits'],
  ['credit_expiry_days', 'Credit expiry'],
  ['monthly_free_upload_bytes', 'Monthly free credits'],
  ['upload_limit', 'Upload allowance'],
  ['download_limit', 'Download allowance'],
  ['model', 'Model'],
  ['is_partner', 'Partner'],
]);

const formatValue = (field: string, value: string | null): string => {
  if (value === null) return 'default';
  if (field.endsWith('_bytes') || field.endsWith('_limit')) {
    return formatStorageSize(Number(value));
  }
  if (field === 'credit_expiry_days') return `${value} days`;
  if (field === 'is_partner') return value === 'true' ? 'yes' : 'no';
  return value;
};

/** A dialog on the admin account page. */
export const AdminDialog = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <Transition appear show as={Fragment}>
    <Dialog as='div' className='relative z-10' onClose={onClose}>
      <TransitionChild
        as={Fragment}
        enter='ease-out duration-300'
        enterFrom='opacity-0'
        enterTo='opacity-100'
        leave='ease-in duration-200'
        leaveFrom='opacity-100'
        leaveTo='opacity-0'
      >
        <div className='fixed inset-0 bg-background-hover' />
      </TransitionChild>

      <div className='fixed inset-0 overflow-y-auto'>
        <div className='flex min-h-full items-center justify-center p-4 text-center'>
          <TransitionChild
            as={Fragment}
            enter='ease-out duration-300'
            enterFrom='opacity-0 scale-95'
            enterTo='opacity-100 scale-100'
            leave='ease-in duration-200'
            leaveFrom='opacity-100 scale-100'
            leaveTo='opacity-0 scale-95'
          >
            <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-background p-6 text-left align-middle shadow-xl transition-all'>
              <DialogTitle
                as='h3'
                className='text-lg font-medium leading-6 text-foreground'
              >
                {title}
              </DialogTitle>
              {children}
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </Transition>
);

// An optional byte amount: null when left empty, undefined when invalid.
const optionalBytes = (value: { amount: string; unit: ByteUnit }) =>
  value.amount.trim() === ''
    ? null
    : (amountToBytes(value.amount, value.unit) ?? undefined);

const TermsModal = ({
  account,
  onClose,
  onSaved,
}: {
  account: AdminAccountDetails;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { api } = useNetwork();
  const [model, setModel] = useState(account.model);
  const [download, setDownload] = useState(() =>
    bytesToAmount(account.downloadLimit),
  );
  const [max, setMax] = useState(() =>
    account.maxPurchasedBytes === null
      ? { amount: '', unit: 'GB' as ByteUnit }
      : bytesToAmount(account.maxPurchasedBytes),
  );
  const [expiryDays, setExpiryDays] = useState(
    account.creditExpiryDays === null ? '' : String(account.creditExpiryDays),
  );
  const [monthlyFree, setMonthlyFree] = useState(() =>
    bytesToAmount(account.monthlyFreeUploadBytes),
  );
  const [grantAmount, setGrantAmount] = useState({
    amount: '',
    unit: 'GB' as ByteUnit,
  });
  const [grantDays, setGrantDays] = useState(
    String(
      account.creditExpiryDays ?? account.defaultCreditTerms.creditExpiryDays,
    ),
  );
  const [reason, setReason] = useState('');

  const monthly = model === AccountModel.Monthly;
  const downloadBytes = amountToBytes(download.amount, download.unit);
  const maxBytes = optionalBytes(max);
  const days = Number(expiryDays);
  const monthlyFreeBytes = amountToBytes(monthlyFree.amount, monthlyFree.unit);
  // One-off accounts get one-time free credits, granted on save.
  const grantBytes = monthly ? null : optionalBytes(grantAmount);
  const grantExpiryDays = Number(grantDays);
  const granting = typeof grantBytes === 'number' && grantBytes > 0;
  // Switching to one-off ends the monthly free credits.
  const endsMonthly = !monthly && account.monthlyFreeUploadBytes > 0;

  const valid =
    downloadBytes !== null &&
    maxBytes !== undefined &&
    (maxBytes === null || maxBytes > 0) &&
    (expiryDays.trim() === '' || (Number.isInteger(days) && days > 0)) &&
    (!monthly || monthlyFreeBytes !== null) &&
    // An amount that rounds to 0 bytes is not a grant: refuse it rather
    // than save without granting.
    grantBytes !== undefined &&
    grantBytes !== 0 &&
    (!granting ||
      (Number.isInteger(grantExpiryDays) &&
        grantExpiryDays >= 1 &&
        grantExpiryDays <= 36500 &&
        reason.trim() !== ''));

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      // A partner account has no free upload allowance, so the upload limit
      // stays 0. Its free uploads are free credits.
      await api.updateAccount(account.id, model, 0, downloadBytes!, {
        maxPurchasedBytes: maxBytes ?? null,
        creditExpiryDays: expiryDays.trim() === '' ? null : days,
        monthlyFreeUploadBytes: monthly ? monthlyFreeBytes! : 0,
        reason: reason.trim() || undefined,
      });
      if (!granting) return { granted: false, grantError: null };
      try {
        await api.grantFreeCredits(account.id, {
          uploadBytes: grantBytes,
          expiresInDays: grantExpiryDays,
          reason: reason.trim(),
        });
        return { granted: true, grantError: null };
      } catch (error) {
        return { granted: false, grantError: error as Error };
      }
    },
    onSuccess: ({ granted, grantError }) => {
      if (grantError) {
        toast.error(
          `Terms saved, but the free credits were not granted: ${grantError.message}`,
        );
      } else {
        toast.success(
          granted ? 'Terms saved and free credits granted' : 'Terms updated',
        );
      }
      onSaved();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const inputClass =
    'w-full rounded border border-border bg-background px-2 py-1 text-foreground';
  const noteClass = 'mt-1 block text-xs text-gray-500';

  return (
    <AdminDialog title='Edit terms' onClose={onClose}>
      <form
        className='mt-4 space-y-4'
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save();
        }}
      >
        <label className='block text-sm text-foreground'>
          Model
          <select
            className={inputClass}
            value={model}
            onChange={(e) => setModel(e.target.value as AccountModel)}
          >
            <option value={AccountModel.Monthly}>Monthly</option>
            <option value={AccountModel.OneOff}>One-off</option>
          </select>
          <span className={noteClass}>
            {monthly
              ? 'Free credits are issued every UTC month and the download allowance resets monthly.'
              : 'Free credits are granted as one-time amounts and the download allowance is not renewed.'}
          </span>
        </label>

        <fieldset className='space-y-3 rounded-lg border border-gray-200 p-3'>
          <legend className='px-1 text-sm font-medium text-foreground'>
            Free credits
          </legend>
          {monthly ? (
            <ByteAmountInput
              label='Monthly free credits (0 for none)'
              amount={monthlyFree.amount}
              unit={monthlyFree.unit}
              onChange={setMonthlyFree}
            >
              <span className={noteClass}>
                A change applies at once: what is left of this month&apos;s
                ends, and the new amount less what this month has used replaces
                it.
              </span>
            </ByteAmountInput>
          ) : (
            <>
              {endsMonthly && (
                <p className='rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'>
                  This stops the monthly free credits of{' '}
                  {formatStorageSize(account.monthlyFreeUploadBytes)}: what is
                  left of this month&apos;s ends now.
                </p>
              )}
              <ByteAmountInput
                label='One-time free credits to grant now (optional, empty for none)'
                amount={grantAmount.amount}
                unit={grantAmount.unit}
                placeholder='None'
                onChange={setGrantAmount}
              >
                <span className={noteClass}>
                  Added to what was granted before, and listed under Free
                  Credits. Granted credits can&apos;t be taken back.
                </span>
              </ByteAmountInput>
              {granting && (
                <label className='block text-sm text-foreground'>
                  Expires after (days)
                  <input
                    type='text'
                    className={inputClass}
                    value={grantDays}
                    onChange={(e) => setGrantDays(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
        </fieldset>

        <ByteAmountInput
          label='Download allowance'
          amount={download.amount}
          unit={download.unit}
          onChange={setDownload}
        />
        <ByteAmountInput
          label='Max purchased credits held (empty for the default)'
          amount={max.amount}
          unit={max.unit}
          placeholder={`Default (${formatStorageSize(account.defaultCreditTerms.maxPurchasedBytes)})`}
          onChange={setMax}
        />
        <label className='block text-sm text-foreground'>
          Credit expiry for new purchases (days, empty for the default)
          <input
            type='text'
            className={inputClass}
            placeholder={`Default (${account.defaultCreditTerms.creditExpiryDays} days)`}
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
          />
        </label>
        <label className='block text-sm text-foreground'>
          {granting ? 'Reason (required for a grant)' : 'Reason (optional)'}
          <input
            type='text'
            className={inputClass}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className='flex justify-end'>
          <Button
            type='submit'
            variant='primary'
            disabled={!valid || isPending}
          >
            {isPending
              ? 'Saving…'
              : granting
                ? `Save and grant ${formatStorageSize(grantBytes)}`
                : 'Save'}
          </Button>
        </div>
      </form>
    </AdminDialog>
  );
};

/**
 * The commercial terms of a partner account, with the history of their
 * changes. Credit overrides apply to purchases and batches from now on;
 * batches already granted keep their expiry.
 */
export const PartnerTerms = ({
  account,
  onChanged,
}: {
  account: AdminAccountDetails;
  onChanged: () => void;
}) => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { defaultCreditTerms } = account;

  const changesKey = ['adminAccountTermsChanges', account.id];
  const { data: changes, isLoading } = useQuery({
    queryKey: changesKey,
    queryFn: () => api.getAccountTermsChanges(account.id),
  });

  // Shared with the Free Credits section, which loads the same list.
  const { data: freeCredits } = useQuery({
    queryKey: [
      'adminAccountFreeCredits',
      account.id,
      account.monthlyFreeUploadBytes,
    ],
    queryFn: () => api.getAccountFreeCredits(account.id),
  });
  const grants = freeCredits?.filter((c) => c.kind === 'free_one_time');
  const monthly = account.model === AccountModel.Monthly;

  const terms = [
    ['Model', monthly ? 'Monthly' : 'One-off'],
    [
      'Free upload allowance',
      // Partner accounts created before #890 still have one until edited.
      account.uploadLimit === 0
        ? 'None, uploads use credits'
        : `${formatStorageSize(account.uploadLimit)} (saving the terms sets it to 0)`,
    ],
    // A one-off account has no monthly free credits.
    ...(monthly || account.monthlyFreeUploadBytes > 0
      ? [
          [
            'Monthly free credits',
            account.monthlyFreeUploadBytes === 0
              ? 'None'
              : `${formatStorageSize(account.monthlyFreeUploadBytes)} per UTC month`,
          ],
        ]
      : []),
    // Shown on the monthly model only once there are any.
    ...(!monthly || (grants && grants.length > 0)
      ? [
          [
            'One-time free credits',
            !grants
              ? '…'
              : grants.length === 0
                ? 'None granted'
                : `${formatStorageSize(
                    grants.reduce(
                      (total, c) => total + Number(c.uploadBytesOriginal),
                      0,
                    ),
                  )} in ${grants.length} grant${grants.length === 1 ? '' : 's'}`,
          ],
        ]
      : []),
    [
      'Download allowance',
      `${formatStorageSize(account.downloadLimit)} (${account.model === AccountModel.Monthly ? 'resets monthly' : 'one-off'})`,
    ],
    [
      'Max purchased credits held',
      account.maxPurchasedBytes === null
        ? `Default (${formatStorageSize(defaultCreditTerms.maxPurchasedBytes)})`
        : formatStorageSize(account.maxPurchasedBytes),
    ],
    [
      'Credit expiry for new purchases',
      account.creditExpiryDays === null
        ? `Default (${defaultCreditTerms.creditExpiryDays} days)`
        : `${account.creditExpiryDays} days`,
    ],
  ];

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='flex items-center gap-2 text-lg font-semibold'>
            <FileText className='h-5 w-5' />
            Terms
          </h2>
          <Button variant='lightAccent' onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          {terms.map(([label, value]) => (
            <div key={label} className='rounded-lg border border-gray-200 p-4'>
              <p className='text-xs text-gray-500'>{label}</p>
              <p className='mt-1 font-medium'>{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-4 flex items-center gap-2 text-lg font-semibold'>
          <History className='h-5 w-5' />
          Terms Changes
        </h2>
        {isLoading ? (
          <div className='flex items-center justify-center py-4'>
            <Loader className='h-5 w-5 animate-spin' />
          </div>
        ) : (
          <Table className='min-w-full'>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>When</TableHeadCell>
                <TableHeadCell>Term</TableHeadCell>
                <TableHeadCell>Change</TableHeadCell>
                <TableHeadCell>By</TableHeadCell>
                <TableHeadCell>Reason</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {changes?.map((change: AccountTermsChange) => (
                <TableBodyRow key={change.id}>
                  <TableBodyCell>{formatDate(change.createdAt)}</TableBodyCell>
                  <TableBodyCell>
                    {FIELD_LABEL.get(change.field) ?? change.field}
                  </TableBodyCell>
                  <TableBodyCell>
                    {formatValue(change.field, change.oldValue)} →{' '}
                    {formatValue(change.field, change.newValue)}
                  </TableBodyCell>
                  <TableBodyCell>
                    <CopiableText
                      text={change.changedBy}
                      className='break-all font-mono text-sm'
                    />
                  </TableBodyCell>
                  <TableBodyCell>{change.reason ?? '—'}</TableBodyCell>
                </TableBodyRow>
              ))}
              {changes?.length === 0 && (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={5}
                    className='py-6 text-center text-gray-500'
                  >
                    No changes yet
                  </TableBodyCell>
                </TableBodyRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Remounted per opening so the form starts from the current terms. */}
      {editing && (
        <TermsModal
          account={account}
          onClose={() => setEditing(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: changesKey });
            // A save can grant free credits or end the month's.
            queryClient.invalidateQueries({
              queryKey: ['adminAccountFreeCredits', account.id],
            });
            onChanged();
          }}
        />
      )}
    </div>
  );
};

'use client';

import { Fragment, useState } from 'react';
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
import { formatBytes } from '@/utils/number';
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

const GiB = 1024 ** 3;

const FIELD_LABEL = new Map([
  ['max_purchased_bytes', 'Max purchased credits'],
  ['credit_expiry_days', 'Credit expiry'],
  ['upload_limit', 'Upload allowance'],
  ['download_limit', 'Download allowance'],
  ['model', 'Model'],
  ['is_partner', 'Partner'],
]);

const formatValue = (field: string, value: string | null): string => {
  if (value === null) return 'default';
  if (field.endsWith('_bytes') || field.endsWith('_limit')) {
    return formatBytes(Number(value));
  }
  if (field === 'credit_expiry_days') return `${value} days`;
  if (field === 'is_partner') return value === 'true' ? 'yes' : 'no';
  return value;
};

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
  const [downloadGiB, setDownloadGiB] = useState(
    String(account.downloadLimit / GiB),
  );
  const [maxGiB, setMaxGiB] = useState(
    account.maxPurchasedBytes === null
      ? ''
      : String(account.maxPurchasedBytes / GiB),
  );
  const [expiryDays, setExpiryDays] = useState(
    account.creditExpiryDays === null ? '' : String(account.creditExpiryDays),
  );
  const [reason, setReason] = useState('');

  const download = Number(downloadGiB);
  const max = Number(maxGiB);
  const days = Number(expiryDays);
  const valid =
    downloadGiB.trim() !== '' &&
    download >= 0 &&
    (maxGiB.trim() === '' || max > 0) &&
    (expiryDays.trim() === '' || (Number.isInteger(days) && days > 0));

  const { mutate: save, isPending } = useMutation({
    // A partner account has no free uploads, so the upload limit stays 0.
    mutationFn: () =>
      api.updateAccount(account.id, model, 0, Math.round(download * GiB), {
        maxPurchasedBytes: maxGiB.trim() === '' ? null : Math.round(max * GiB),
        creditExpiryDays: expiryDays.trim() === '' ? null : days,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Terms updated');
      onSaved();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const inputClass =
    'w-full rounded border border-border bg-background px-2 py-1 text-foreground';

  return (
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
                  Edit terms
                </DialogTitle>
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
                      <option value={AccountModel.Monthly}>
                        Monthly (allowance resets each month)
                      </option>
                      <option value={AccountModel.OneOff}>One-off</option>
                    </select>
                  </label>
                  <label className='block text-sm text-foreground'>
                    Download allowance (GiB)
                    <input
                      type='text'
                      className={inputClass}
                      value={downloadGiB}
                      onChange={(e) => setDownloadGiB(e.target.value)}
                    />
                  </label>
                  <label className='block text-sm text-foreground'>
                    Max purchased credits held (GiB, empty for the default)
                    <input
                      type='text'
                      className={inputClass}
                      placeholder={`Default (${formatBytes(account.defaultCreditTerms.maxPurchasedBytes)})`}
                      value={maxGiB}
                      onChange={(e) => setMaxGiB(e.target.value)}
                    />
                  </label>
                  <label className='block text-sm text-foreground'>
                    Credit expiry for new purchases (days, empty for the
                    default)
                    <input
                      type='text'
                      className={inputClass}
                      placeholder={`Default (${account.defaultCreditTerms.creditExpiryDays} days)`}
                      value={expiryDays}
                      onChange={(e) => setExpiryDays(e.target.value)}
                    />
                  </label>
                  <label className='block text-sm text-foreground'>
                    Reason (optional)
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
                      {isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </form>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
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

  const terms = [
    ['Free upload allowance', 'None, uploads use purchased credits'],
    [
      'Download allowance',
      `${formatBytes(account.downloadLimit)} (${account.model === AccountModel.Monthly ? 'resets monthly' : 'one-off'})`,
    ],
    [
      'Max purchased credits held',
      account.maxPurchasedBytes === null
        ? `Default (${formatBytes(defaultCreditTerms.maxPurchasedBytes)})`
        : formatBytes(account.maxPurchasedBytes),
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
            onChanged();
          }}
        />
      )}
    </div>
  );
};

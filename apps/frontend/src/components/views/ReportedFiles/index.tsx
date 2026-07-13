/* eslint-disable camelcase */
'use client';

import { Fragment, useCallback, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { BanIcon, FlagIcon, RefreshCwIcon } from 'lucide-react';
import { Button, ROUTES } from '@auto-drive/ui';
import { isAdminUser } from '@auto-drive/models';
import { useFilesToBeReviewedQuery } from 'gql/graphql';
import { useNetwork } from 'contexts/network';
import { useUserStore } from 'globalStates/user';
import { CopiableText } from '@/components/atoms/CopiableText';
import { formatCid } from '@/utils/table';
import { formatBytes } from '@/utils/number';

// The queue is expected to be small; a generous single-page limit avoids
// paginating admin tooling that will rarely hold more than a handful of files.
const REVIEW_LIMIT = 200;

type ConfirmState = { cid: string; action: 'ban' | 'dismiss' } | null;

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const ReportedFiles = () => {
  const { api, network } = useNetwork();
  const user = useUserStore((e) => e.user);
  const isAdmin = !!user && isAdminUser(user);

  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, loading, refetch } = useFilesToBeReviewedQuery({
    variables: { limit: REVIEW_LIMIT, offset: 0 },
    fetchPolicy: 'cache-and-network',
    skip: !isAdmin,
  });

  const files = data?.metadata_roots ?? [];
  const totalCount =
    data?.metadata_roots_aggregate?.aggregate?.count ?? files.length;

  const handleConfirm = useCallback(async () => {
    if (!confirm) return;
    const { cid, action } = confirm;
    const isBan = action === 'ban';
    const toastId = toast.loading(
      isBan ? 'Banning file...' : 'Dismissing report...',
    );
    setIsSubmitting(true);
    try {
      await (isBan ? api.banFile(cid) : api.dismissReport(cid));
      toast.success(isBan ? 'File banned' : 'Report dismissed', {
        id: toastId,
      });
      setConfirm(null);
      await refetch();
    } catch {
      toast.error(isBan ? 'Failed to ban file' : 'Failed to dismiss report', {
        id: toastId,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [confirm, api, refetch]);

  // The GraphQL feed is public, so gate the admin-only view in the UI too — the
  // ban/dismiss mutations are independently enforced as admin-only server-side.
  if (user && !isAdmin) {
    return (
      <div className='py-12 text-center text-gray-500'>
        You do not have access to this page.
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6 p-2'>
      <div>
        <h1 className='text-2xl font-bold'>Reported Files</h1>
        <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
          Files that users have flagged for review. Dismiss a report to clear
          the flag, or ban the file to block it from download across the
          network. If a dismissed file is reported again it reappears here.
        </p>
      </div>

      <div className='flex items-center justify-between'>
        <span className='text-sm text-gray-600 dark:text-gray-400'>
          {totalCount} file{totalCount === 1 ? '' : 's'} awaiting review
        </span>
        <Button
          variant='lightAccent'
          className='inline-flex items-center gap-1 text-sm'
          onClick={() => refetch()}
        >
          <RefreshCwIcon className='h-4 w-4' />
          Refresh
        </Button>
      </div>

      {loading && files.length === 0 ? (
        <div className='py-8 text-center text-gray-500'>Loading...</div>
      ) : files.length === 0 ? (
        <div className='flex flex-col items-center gap-2 py-12 text-center text-gray-500'>
          <FlagIcon className='h-8 w-8 opacity-50' />
          <span>No reported files. Nothing to review.</span>
        </div>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-left text-sm'>
            <thead className='border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700'>
              <tr>
                <th className='px-4 py-3'>Name</th>
                <th className='px-4 py-3'>CID</th>
                <th className='px-4 py-3'>Type</th>
                <th className='px-4 py-3'>Size</th>
                <th className='px-4 py-3'>Uploaded</th>
                <th className='px-4 py-3 text-right'>Actions</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-100 dark:divide-gray-700'>
              {files.map((file) => {
                const cid = file.headCid ?? '';
                const name = file.name || `No name (${cid.slice(0, 12)}…)`;
                return (
                  <tr
                    key={cid}
                    className='hover:bg-gray-50 dark:hover:bg-gray-800'
                  >
                    <td className='max-w-[220px] truncate px-4 py-3'>
                      <Link
                        href={ROUTES.objectDetails(network.id, cid)}
                        prefetch={false}
                        className='font-medium hover:text-primary hover:underline'
                        title={name}
                      >
                        {name}
                      </Link>
                    </td>
                    <td className='px-4 py-3'>
                      <CopiableText text={cid} displayText={formatCid(cid)} />
                    </td>
                    <td className='px-4 py-3 capitalize'>{file.type ?? '-'}</td>
                    <td className='px-4 py-3'>
                      {file.size != null ? formatBytes(Number(file.size)) : '-'}
                    </td>
                    <td className='px-4 py-3 text-xs'>
                      {file.createdAt ? formatDate(file.createdAt) : 'Unknown'}
                    </td>
                    <td className='px-4 py-3'>
                      <div className='flex items-center justify-end gap-2'>
                        <Link
                          href={ROUTES.objectDetails(network.id, cid)}
                          prefetch={false}
                          className='rounded px-2 py-1 text-sm text-foreground hover:bg-background-hover'
                        >
                          View
                        </Link>
                        <Button
                          variant='lightAccent'
                          className='text-xs'
                          onClick={() => setConfirm({ cid, action: 'dismiss' })}
                        >
                          Dismiss
                        </Button>
                        <Button
                          variant='lightDanger'
                          className='inline-flex items-center gap-1 text-xs'
                          onClick={() => setConfirm({ cid, action: 'ban' })}
                        >
                          <BanIcon className='h-3.5 w-3.5' />
                          Ban
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmActionModal
        confirm={confirm}
        isSubmitting={isSubmitting}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
};

const ConfirmActionModal = ({
  confirm,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  confirm: ConfirmState;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const isBan = confirm?.action === 'ban';

  return (
    <Transition appear show={confirm !== null} as={Fragment}>
      <Dialog as='div' className='relative z-10' onClose={onCancel}>
        <TransitionChild
          as={Fragment}
          enter='ease-out duration-300'
          enterFrom='opacity-0'
          enterTo='opacity-100'
          leave='ease-in duration-200'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <div className='fixed inset-0 bg-black/25' />
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
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-card p-6 text-left align-middle text-card-foreground shadow-xl transition-all'>
                <DialogTitle as='h3' className='text-lg font-medium leading-6'>
                  {isBan ? 'Ban File' : 'Dismiss Report'}
                </DialogTitle>
                <div className='mt-2'>
                  <p className='text-sm text-gray-500 dark:text-gray-400'>
                    {isBan
                      ? 'Are you sure you want to ban this file? It will be blocked from download across the network.'
                      : 'Are you sure you want to dismiss this report? It will be removed from the review queue.'}
                  </p>
                  <p className='mt-2 break-all font-mono text-sm text-gray-600 dark:text-gray-300'>
                    {confirm?.cid}
                  </p>
                </div>
                <div className='mt-6 flex justify-end gap-3'>
                  <Button
                    variant='outline'
                    onClick={onCancel}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant={isBan ? 'danger' : 'lightAccent'}
                    onClick={onConfirm}
                    disabled={isSubmitting}
                  >
                    {isBan ? 'Ban File' : 'Dismiss Report'}
                  </Button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

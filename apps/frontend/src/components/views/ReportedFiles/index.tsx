/* eslint-disable camelcase */
'use client';

import { Fragment, ReactNode, useCallback, useMemo, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import {
  BanIcon,
  CheckCircleIcon,
  FlagIcon,
  RefreshCwIcon,
  UndoIcon,
} from 'lucide-react';
import { Button, Network, ROUTES } from '@auto-drive/ui';
import { isAdminUser, getReportStatus, ReportStatus } from '@auto-drive/models';
import {
  FilesToBeReviewedQuery,
  useFilesToBeReviewedQuery,
  useReportedFilesHistoryQuery,
} from 'gql/graphql';
import { useNetwork } from 'contexts/network';
import { useUserStore } from 'globalStates/user';
import { CopiableText } from '@/components/atoms/CopiableText';
import { formatCid } from '@/utils/table';
import { formatBytes } from '@/utils/number';
import { formatDate } from '@/utils/time';

type ReportedFile = FilesToBeReviewedQuery['metadata'][number];

// Needs Review and Review History are fetched (and paginated) independently
// so a large history can never crowd pending files out of a shared row
// budget — each section's own aggregate count decides whether "Load more"
// is needed, instead of a single page-wide limit.
const PAGE_SIZE = 200;

type Action = 'ban' | 'dismiss' | 'unban';
type ConfirmState = { cid: string; action: Action } | null;

const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pending review',
  dismissed: 'Dismissed',
  banned: 'Banned',
};

const STATUS_BADGE_CLASSES: Record<ReportStatus, string> = {
  pending:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  dismissed: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  banned: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

const ACTION_COPY: Record<
  Action,
  { pending: string; success: string; failure: string }
> = {
  ban: {
    pending: 'Banning file...',
    success: 'File banned',
    failure: 'Failed to ban file',
  },
  unban: {
    pending: 'Unbanning file...',
    success: 'File unbanned',
    failure: 'Failed to unban file',
  },
  dismiss: {
    pending: 'Dismissing report...',
    success: 'Report dismissed',
    failure: 'Failed to dismiss report',
  },
};

const MODAL_COPY: Record<
  Action,
  {
    title: string;
    body: string;
    confirmLabel: string;
    variant: 'danger' | 'lightAccent';
  }
> = {
  ban: {
    title: 'Ban File',
    body: 'Are you sure you want to ban this file? It will be blocked from download across the network. You can unban it later from this page.',
    confirmLabel: 'Ban File',
    variant: 'danger',
  },
  unban: {
    title: 'Unban File',
    body: 'Are you sure you want to unban this file? It will become downloadable across the network again.',
    confirmLabel: 'Unban File',
    variant: 'lightAccent',
  },
  dismiss: {
    title: 'Dismiss Report',
    body: 'Are you sure you want to dismiss this report? The file stays listed here, marked as dismissed, in case you want to revisit it later.',
    confirmLabel: 'Dismiss Report',
    variant: 'lightAccent',
  },
};

const StatusBadge = ({ status }: { status: ReportStatus }) => (
  <span
    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}
  >
    {STATUS_LABEL[status]}
  </span>
);

// The query dedups same-cid rows via distinct_on, which forces ordering by
// head_cid first — re-sort by recency here for display.
const sortByRecency = (files: ReportedFile[]) =>
  [...files].sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );

export const ReportedFiles = () => {
  const { api, network } = useNetwork();
  const user = useUserStore((e) => e.user);
  const isAdmin = !!user && isAdminUser(user);
  const apolloClient = useApolloClient();

  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingPageSize, setPendingPageSize] = useState(PAGE_SIZE);
  const [historyPageSize, setHistoryPageSize] = useState(PAGE_SIZE);

  const { data: pendingData, loading: pendingLoading } =
    useFilesToBeReviewedQuery({
      variables: { limit: pendingPageSize, offset: 0 },
      fetchPolicy: 'cache-and-network',
      skip: !isAdmin,
    });
  const { data: historyData, loading: historyLoading } =
    useReportedFilesHistoryQuery({
      variables: { limit: historyPageSize, offset: 0 },
      fetchPolicy: 'cache-and-network',
      skip: !isAdmin,
    });

  const pendingFiles = useMemo(
    () => sortByRecency(pendingData?.metadata ?? []),
    [pendingData],
  );
  const historyFiles = useMemo(
    () => sortByRecency(historyData?.metadata ?? []),
    [historyData],
  );
  const pendingTotal =
    pendingData?.metadata_aggregate?.aggregate?.count ?? pendingFiles.length;
  const historyTotal =
    historyData?.metadata_aggregate?.aggregate?.count ?? historyFiles.length;
  const totalCount = pendingTotal + historyTotal;

  // Refetch by operation name (not a bound `refetch()`) so every active
  // instance of these queries updates, however its variables differ — e.g.
  // the "Files to be reviewed" banner queries FilesToBeReviewed at a fixed
  // limit, distinct from this page's own paginated (Load more) limit, so a
  // `refetch()` bound to this page's instance alone would never reach it.
  const refetchAll = useCallback(async () => {
    await apolloClient.refetchQueries({
      include: ['FilesToBeReviewed', 'ReportedFilesHistory'],
    });
  }, [apolloClient]);

  const handleConfirm = useCallback(async () => {
    if (!confirm) return;
    const { cid, action } = confirm;
    const toastId = toast.loading(ACTION_COPY[action].pending);
    setIsSubmitting(true);
    try {
      if (action === 'ban') await api.banFile(cid);
      else if (action === 'unban') await api.unbanFile(cid);
      else await api.dismissReport(cid);
    } catch {
      toast.error(ACTION_COPY[action].failure, { id: toastId });
      setIsSubmitting(false);
      return;
    }
    toast.success(ACTION_COPY[action].success, { id: toastId });
    setConfirm(null);
    // An action moves a file between sections (e.g. pending -> banned), so
    // both queries need refetching regardless of which list it came from. A
    // refetch failure must not overwrite the success toast — the action DID
    // succeed; the lists just stay stale until the next manual Refresh.
    await refetchAll().catch(() => undefined);
    setIsSubmitting(false);
  }, [confirm, api, refetchAll]);

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
          Files that users have flagged for review, kept here permanently so
          decisions can be revisited. Dismiss a report to clear the flag, or ban
          the file to block it from download across the network — either
          decision can be reversed later from this same list.
        </p>
      </div>

      <div className='flex items-center justify-between'>
        <span className='text-sm text-gray-600 dark:text-gray-400'>
          {totalCount} reported file{totalCount === 1 ? '' : 's'}
        </span>
        <Button
          variant='lightAccent'
          className='inline-flex items-center gap-1 text-sm'
          onClick={() => refetchAll()}
        >
          <RefreshCwIcon className='h-4 w-4' />
          Refresh
        </Button>
      </div>

      <ReportSection
        title='Needs Review'
        description='Newly reported files awaiting a decision.'
        emptyIcon={<FlagIcon className='h-8 w-8 opacity-50' />}
        emptyMessage='No files currently need review.'
        files={pendingFiles}
        totalCount={pendingTotal}
        isLoading={pendingLoading && pendingFiles.length === 0}
        onLoadMore={() => setPendingPageSize((size) => size + PAGE_SIZE)}
        showStatusColumn={false}
        network={network}
        onAction={setConfirm}
      />
      <ReportSection
        title='Review History'
        description='Files already dismissed or banned. Revisit and change the decision anytime.'
        emptyIcon={<CheckCircleIcon className='h-8 w-8 opacity-50' />}
        emptyMessage='No previously reviewed files yet.'
        files={historyFiles}
        totalCount={historyTotal}
        isLoading={historyLoading && historyFiles.length === 0}
        onLoadMore={() => setHistoryPageSize((size) => size + PAGE_SIZE)}
        showStatusColumn={true}
        network={network}
        onAction={setConfirm}
      />

      <ConfirmActionModal
        confirm={confirm}
        isSubmitting={isSubmitting}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
};

const ReportSection = ({
  title,
  description,
  emptyIcon,
  emptyMessage,
  files,
  totalCount,
  isLoading,
  onLoadMore,
  showStatusColumn,
  network,
  onAction,
}: {
  title: string;
  description: string;
  emptyIcon: ReactNode;
  emptyMessage: string;
  files: ReportedFile[];
  totalCount: number;
  isLoading: boolean;
  onLoadMore: () => void;
  showStatusColumn: boolean;
  network: Network;
  onAction: (state: ConfirmState) => void;
}) => (
  <div className='flex flex-col gap-3'>
    <div>
      <h2 className='text-lg font-semibold'>
        {title} ({totalCount})
      </h2>
      <p className='text-sm text-gray-600 dark:text-gray-400'>{description}</p>
    </div>

    {isLoading ? (
      <div className='py-8 text-center text-gray-500'>Loading...</div>
    ) : files.length === 0 ? (
      <div className='flex flex-col items-center gap-2 py-10 text-center text-gray-500'>
        {emptyIcon}
        <span>{emptyMessage}</span>
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
              {showStatusColumn && <th className='px-4 py-3'>Status</th>}
              <th className='px-4 py-3 text-right'>Actions</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-100 dark:divide-gray-700'>
            {files.map((file) => {
              const cid = file.headCid ?? '';
              const name = file.name || `No name (${cid.slice(0, 12)}…)`;
              const status = getReportStatus(file.tags ?? []);
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
                  {showStatusColumn && (
                    <td className='px-4 py-3'>
                      <StatusBadge status={status} />
                    </td>
                  )}
                  <td className='px-4 py-3'>
                    <div className='flex items-center justify-end gap-2'>
                      <Link
                        href={ROUTES.objectDetails(network.id, cid)}
                        prefetch={false}
                        className='rounded px-2 py-1 text-sm text-foreground hover:bg-background-hover'
                      >
                        View
                      </Link>
                      {status === 'banned' ? (
                        <Button
                          variant='lightAccent'
                          className='inline-flex items-center gap-1 text-xs'
                          onClick={() => onAction({ cid, action: 'unban' })}
                        >
                          <UndoIcon className='h-3.5 w-3.5' />
                          Unban
                        </Button>
                      ) : (
                        <>
                          {status === 'pending' && (
                            <Button
                              variant='lightAccent'
                              className='text-xs'
                              onClick={() =>
                                onAction({ cid, action: 'dismiss' })
                              }
                            >
                              Dismiss
                            </Button>
                          )}
                          <Button
                            variant='lightDanger'
                            className='inline-flex items-center gap-1 text-xs'
                            onClick={() => onAction({ cid, action: 'ban' })}
                          >
                            <BanIcon className='h-3.5 w-3.5' />
                            Ban
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {files.length < totalCount && (
          <div className='flex justify-center py-3'>
            <Button
              variant='lightAccent'
              className='text-xs'
              onClick={onLoadMore}
            >
              Load more ({totalCount - files.length} remaining)
            </Button>
          </div>
        )}
      </div>
    )}
  </div>
);

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
  const copy = confirm ? MODAL_COPY[confirm.action] : null;

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
                  {copy?.title}
                </DialogTitle>
                <div className='mt-2'>
                  <p className='text-sm text-gray-500 dark:text-gray-400'>
                    {copy?.body}
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
                    variant={copy?.variant}
                    onClick={onConfirm}
                    disabled={isSubmitting}
                  >
                    {copy?.confirmLabel}
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

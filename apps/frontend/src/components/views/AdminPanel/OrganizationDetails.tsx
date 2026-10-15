'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '@/utils/number';
import {
  Loader,
  ArrowLeft,
  Building2,
  Upload,
  Download,
  HardDrive,
  Calendar,
  Clock,
  CreditCard,
} from 'lucide-react';
import { gql, useApolloClient } from '@apollo/client';
import { Table } from '@/components/molecules/Table';
import {
  TableHead,
  TableHeadRow,
  TableHeadCell,
} from '@/components/molecules/Table/TableHead';
import {
  TableBody,
  TableBodyRow,
  TableBodyCell,
} from '@/components/molecules/Table/TableBody';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useNetwork } from 'contexts/network';
import { ROUTES } from '@auto-drive/ui';
import {
  AccountInfoWithUser,
  AccountModel,
  InteractionType,
  UserRole,
} from '@auto-drive/models';
import type { AdminUserCreditBatch } from '@/services/api';
import {
  describePayment,
  getBatchStatus,
  STATUS_CLASSES,
  STATUS_LABEL,
  summarizePurchases,
} from '@/utils/credits';
import { CopiableText } from '@/components/atoms/CopiableText';
import { formatCid } from '@/utils/table';
import { useUserStore } from 'globalStates/user';
import { useRouter } from 'next/navigation';

// GraphQL query for account interactions. `$type` is `{}` for all types.
const GET_ACCOUNT_INTERACTIONS = gql`
  query GetAccountInteractions(
    $accountId: String!
    $type: String_comparison_exp!
    $limit: Int!
    $offset: Int!
  ) {
    interactions(
      where: { account_id: { _eq: $accountId }, type: $type }
      order_by: { created_at: desc }
      limit: $limit
      offset: $offset
    ) {
      id
      type
      size
      cid
      created_at
    }
    interactions_aggregate(
      where: { account_id: { _eq: $accountId }, type: $type }
    ) {
      aggregate {
        count
      }
    }
    upload_stats: interactions_aggregate(
      where: { account_id: { _eq: $accountId }, type: { _eq: "upload" } }
    ) {
      aggregate {
        count
        sum {
          size
        }
      }
    }
    download_stats: interactions_aggregate(
      where: { account_id: { _eq: $accountId }, type: { _eq: "download" } }
    ) {
      aggregate {
        count
        sum {
          size
        }
      }
    }
  }
`;

// File names for the CIDs on the current activity page. Objects the viewer
// cannot see (e.g. another user's trashed file) simply have no name.
const GET_NAMES_BY_CID = gql`
  query GetNamesByCid($cids: [String!]!) {
    metadata(where: { head_cid: { _in: $cids } }) {
      head_cid
      name
    }
  }
`;

type ActivityFilter = 'all' | InteractionType;

type Interaction = {
  id: string;
  type: 'upload' | 'download';
  size: string;
  cid: string | null;
  created_at: string;
  name: string | null;
};

type Props = {
  organizationId: string;
};

export const OrganizationDetails = ({ organizationId }: Props) => {
  const { network, api } = useNetwork();
  const router = useRouter();
  const user = useUserStore(({ user }) => user);
  const apolloClient = useApolloClient();

  // `organizationId` is an account ID or an organization ID, as before. The
  // lookup returns one row per member of the organisation, each carrying the
  // same account.
  const [profile, setProfile] = useState<AccountInfoWithUser[] | null>(null);
  const [batches, setBatches] = useState<AdminUserCreditBatch[] | null>(null);
  const [batchesError, setBatchesError] = useState(false);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [totalInteractions, setTotalInteractions] = useState(0);
  const [uploadStats, setUploadStats] = useState({ count: 0, size: 0 });
  const [downloadStats, setDownloadStats] = useState({ count: 0, size: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const account = profile?.[0] ?? null;
  const members = useMemo(() => profile?.map((p) => p.user) ?? [], [profile]);

  // Redirect non-admin users
  useEffect(() => {
    if (user && user.role !== UserRole.Admin) {
      router.push(ROUTES.drive(network.id));
    }
  }, [user, router, network.id]);

  useEffect(() => {
    if (user?.role !== UserRole.Admin) return;
    setIsLoading(true);
    api
      .adminSearchAccounts(organizationId)
      .then((results) =>
        setProfile(
          results.filter(
            (r) =>
              r.id === organizationId || r.organizationId === organizationId,
          ),
        ),
      )
      .catch((error) => {
        console.error('Error fetching account:', error);
        setProfile([]);
      })
      .finally(() => setIsLoading(false));
  }, [api, organizationId, user?.role]);

  // Selected by the account credited, not by buyer: members can buy for a
  // shared account, and a member's earlier purchases stay on their old one.
  useEffect(() => {
    if (!account) return;
    api
      .getAccountCreditBatches(account.id)
      .then(setBatches)
      .catch((error) => {
        console.error('Error fetching purchased credits:', error);
        setBatchesError(true);
      });
  }, [api, account]);

  // Fall back to the raw id, as before, so a link carrying an account ID still
  // shows activity if the account lookup fails.
  const accountId = account?.id ?? (profile ? organizationId : null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setIsLoadingActivity(true);

    (async () => {
      const result = await apolloClient.query({
        query: GET_ACCOUNT_INTERACTIONS,
        variables: {
          accountId,
          type: activityFilter === 'all' ? {} : { _eq: activityFilter },
          limit: itemsPerPage,
          offset: (currentPage - 1) * itemsPerPage,
        },
        fetchPolicy: 'network-only',
      });
      const rows: Omit<Interaction, 'name'>[] = result.data?.interactions ?? [];

      const cids = [...new Set(rows.map((i) => i.cid).filter(Boolean))];
      const names = new Map<string, string>();
      if (cids.length > 0) {
        const namesResult = await apolloClient.query({
          query: GET_NAMES_BY_CID,
          variables: { cids },
        });
        for (const m of namesResult.data?.metadata ?? []) {
          if (m.name && !names.has(m.head_cid)) names.set(m.head_cid, m.name);
        }
      }
      if (cancelled) return;

      setInteractions(
        rows.map((i) => ({
          ...i,
          name: i.cid ? (names.get(i.cid) ?? null) : null,
        })),
      );
      setTotalInteractions(
        result.data?.interactions_aggregate?.aggregate?.count || 0,
      );
      setUploadStats({
        count: result.data?.upload_stats?.aggregate?.count || 0,
        size: Number(result.data?.upload_stats?.aggregate?.sum?.size || 0),
      });
      setDownloadStats({
        count: result.data?.download_stats?.aggregate?.count || 0,
        size: Number(result.data?.download_stats?.aggregate?.sum?.size || 0),
      });
    })()
      .catch((error) => console.error('Error fetching activity:', error))
      .finally(() => {
        if (!cancelled) setIsLoadingActivity(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apolloClient, accountId, activityFilter, currentPage]);

  const purchases = useMemo(
    () => (batches ? summarizePurchases(batches) : null),
    [batches],
  );

  const totalPages = Math.ceil(totalInteractions / itemsPerPage);

  if (!user || user.role !== UserRole.Admin) {
    return (
      <div className='flex items-center justify-center py-20'>
        <Loader className='h-8 w-8 animate-spin' />
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Back Button */}
      <Link
        href={ROUTES.admin(network.id)}
        className='inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
      >
        <ArrowLeft className='h-4 w-4' />
        Back to Admin Dashboard
      </Link>

      {/* Account Info Card */}
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h1 className='mb-4 flex items-center gap-2 text-xl font-semibold'>
          <Building2 className='h-5 w-5' />
          Account Details
        </h1>

        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader className='h-6 w-6 animate-spin' />
          </div>
        ) : !account ? (
          <p className='text-sm text-gray-500'>
            No account found for{' '}
            <span className='font-mono'>{organizationId}</span>.
          </p>
        ) : (
          <div className='space-y-4'>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
              <div className='rounded-lg border border-gray-200 p-4'>
                <p className='text-xs text-gray-500'>Organization ID</p>
                <CopiableText
                  text={account.organizationId}
                  className='mt-1 break-all font-mono text-sm'
                />
              </div>
              <div className='rounded-lg border border-gray-200 p-4'>
                <p className='text-xs text-gray-500'>Account ID</p>
                <CopiableText
                  text={account.id}
                  className='mt-1 break-all font-mono text-sm'
                />
              </div>
              <div className='rounded-lg border border-gray-200 p-4'>
                <p className='text-xs text-gray-500'>Model</p>
                <p className='mt-1 font-medium'>
                  {account.model === AccountModel.OneOff
                    ? 'One-off'
                    : 'Monthly'}
                </p>
              </div>
              <div className='rounded-lg border border-gray-200 p-4'>
                <p className='text-xs text-gray-500'>Upload Credits</p>
                <p className='mt-1 font-medium'>
                  {formatBytes(Number(account.uploadLimit))}
                </p>
              </div>
              <div className='rounded-lg border border-gray-200 p-4'>
                <p className='text-xs text-gray-500'>Pending Upload</p>
                <p className='mt-1 font-medium'>
                  {formatBytes(Number(account.pendingUploadCredits))}
                </p>
              </div>
              <div className='rounded-lg border border-gray-200 p-4'>
                <p className='text-xs text-gray-500'>Download Credits</p>
                <p className='mt-1 font-medium'>
                  {formatBytes(Number(account.downloadLimit))}
                </p>
              </div>
              <div className='rounded-lg border border-gray-200 p-4'>
                <p className='text-xs text-gray-500'>Pending Download</p>
                <p className='mt-1 font-medium'>
                  {formatBytes(Number(account.pendingDownloadCredits))}
                </p>
              </div>
            </div>

            <div className='overflow-hidden rounded-lg border border-gray-200'>
              <Table className='min-w-full'>
                <TableHead>
                  <TableHeadRow>
                    <TableHeadCell>Public ID</TableHeadCell>
                    <TableHeadCell>Username</TableHeadCell>
                    <TableHeadCell>Provider</TableHeadCell>
                    <TableHeadCell>Role</TableHeadCell>
                  </TableHeadRow>
                </TableHead>
                <TableBody>
                  {members.map((member) => (
                    <TableBodyRow key={member.publicId}>
                      <TableBodyCell>
                        <CopiableText
                          text={member.publicId!}
                          className='break-all font-mono text-sm'
                        />
                      </TableBodyCell>
                      <TableBodyCell>
                        {member.oauthUsername ?? '—'}
                      </TableBodyCell>
                      <TableBodyCell>{member.oauthProvider}</TableBodyCell>
                      <TableBodyCell>{member.role}</TableBodyCell>
                    </TableBodyRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Purchased Credits */}
      {account && (
        <div className='rounded-lg border border-gray-200 bg-background p-6'>
          <div className='mb-4 flex items-center justify-between'>
            <h2 className='flex items-center gap-2 text-lg font-semibold'>
              <CreditCard className='h-5 w-5' />
              Purchased Credits
            </h2>
          </div>
          {batchesError ? (
            <p className='text-sm text-gray-500'>
              Purchased credits are unavailable.
            </p>
          ) : !batches || !purchases ? (
            <div className='flex items-center justify-center py-4'>
              <Loader className='h-5 w-5 animate-spin' />
            </div>
          ) : (
            <div className='space-y-4'>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Purchases</p>
                  <p className='mt-1 font-medium'>
                    {purchases.refundedCount > 0
                      ? `${purchases.batchCount} (${purchases.refundedCount} refunded)`
                      : purchases.batchCount}
                  </p>
                </div>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Bytes Purchased</p>
                  <p className='mt-1 font-medium'>
                    {formatBytes(Number(purchases.bytesPurchased))}
                  </p>
                </div>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Bytes Remaining</p>
                  <p className='mt-1 font-medium'>
                    {formatBytes(Number(purchases.bytesRemaining))}
                  </p>
                </div>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Amount Paid</p>
                  <p className='mt-1 font-medium'>
                    {purchases.paid.length > 0
                      ? purchases.paid.join(' + ')
                      : '—'}
                  </p>
                </div>
              </div>
              {batches.length > 0 && (
                <div className='overflow-x-auto rounded-lg border border-gray-200'>
                  <Table className='min-w-full'>
                    <TableHead>
                      <TableHeadRow>
                        <TableHeadCell>Purchased</TableHeadCell>
                        <TableHeadCell>Buyer</TableHeadCell>
                        <TableHeadCell>Bytes</TableHeadCell>
                        <TableHeadCell>Remaining</TableHeadCell>
                        <TableHeadCell>Paid</TableHeadCell>
                        <TableHeadCell>Expires</TableHeadCell>
                        <TableHeadCell>Status</TableHeadCell>
                      </TableHeadRow>
                    </TableHead>
                    <TableBody>
                      {batches.map((batch) => {
                        const status = getBatchStatus(batch);
                        return (
                          <TableBodyRow key={batch.id}>
                            <TableBodyCell>
                              {dayjs(batch.purchasedAt).format('MMM D, YYYY')}
                            </TableBodyCell>
                            <TableBodyCell>
                              <Link
                                href={ROUTES.adminUserCredits(
                                  network.id,
                                  batch.userPublicId,
                                )}
                                className='font-mono text-xs text-blue-600 hover:underline dark:text-blue-400'
                                title='Purchase history and refunds'
                              >
                                {formatCid(batch.userPublicId)}
                              </Link>
                            </TableBodyCell>
                            <TableBodyCell>
                              {formatBytes(Number(batch.uploadBytesOriginal))}
                            </TableBodyCell>
                            <TableBodyCell>
                              {formatBytes(Number(batch.uploadBytesRemaining))}
                            </TableBodyCell>
                            <TableBodyCell>
                              {describePayment(batch).amountPaid}
                            </TableBodyCell>
                            <TableBodyCell>
                              {dayjs(batch.expiresAt).format('MMM D, YYYY')}
                            </TableBodyCell>
                            <TableBodyCell>
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
                              >
                                {batch.refundedAt
                                  ? 'Refunded'
                                  : STATUS_LABEL[status]}
                              </span>
                            </TableBodyCell>
                          </TableBodyRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Statistics Summary */}
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-4 flex items-center gap-2 text-lg font-semibold'>
          <HardDrive className='h-5 w-5' />
          Usage Statistics
        </h2>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4 dark:from-blue-900/20 dark:to-blue-800/20'>
            <div className='flex items-center gap-3'>
              <div className='rounded-lg bg-blue-500 p-2'>
                <Upload className='h-5 w-5 text-white' />
              </div>
              <div>
                <p className='text-xs text-gray-500'>Total Uploads</p>
                <p className='text-xl font-bold text-blue-600 dark:text-blue-400'>
                  {uploadStats.count.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
          <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 dark:from-emerald-900/20 dark:to-emerald-800/20'>
            <div className='flex items-center gap-3'>
              <div className='rounded-lg bg-emerald-500 p-2'>
                <HardDrive className='h-5 w-5 text-white' />
              </div>
              <div>
                <p className='text-xs text-gray-500'>Upload Size</p>
                <p className='text-xl font-bold text-emerald-600 dark:text-emerald-400'>
                  {formatBytes(uploadStats.size)}
                </p>
              </div>
            </div>
          </div>
          <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4 dark:from-purple-900/20 dark:to-purple-800/20'>
            <div className='flex items-center gap-3'>
              <div className='rounded-lg bg-purple-500 p-2'>
                <Download className='h-5 w-5 text-white' />
              </div>
              <div>
                <p className='text-xs text-gray-500'>Total Downloads</p>
                <p className='text-xl font-bold text-purple-600 dark:text-purple-400'>
                  {downloadStats.count.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
          <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-orange-50 to-orange-100 p-4 dark:from-orange-900/20 dark:to-orange-800/20'>
            <div className='flex items-center gap-3'>
              <div className='rounded-lg bg-orange-500 p-2'>
                <HardDrive className='h-5 w-5 text-white' />
              </div>
              <div>
                <p className='text-xs text-gray-500'>Download Size</p>
                <p className='text-xl font-bold text-orange-600 dark:text-orange-400'>
                  {formatBytes(downloadStats.size)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Log */}
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='flex items-center gap-2 text-lg font-semibold'>
            <Clock className='h-5 w-5' />
            Activity Log
          </h2>
          <select
            aria-label='Filter activity by type'
            value={activityFilter}
            onChange={(e) => {
              setActivityFilter(e.target.value as ActivityFilter);
              setCurrentPage(1);
            }}
            className='rounded border border-gray-300 bg-background px-2 py-1 text-sm'
          >
            <option value='all'>All activity</option>
            <option value={InteractionType.Upload}>Uploads</option>
            <option value={InteractionType.Download}>Downloads</option>
          </select>
        </div>
        <div className='overflow-hidden rounded-lg border border-gray-200'>
          <Table className='min-w-full'>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell>File</TableHeadCell>
                <TableHeadCell>Size</TableHeadCell>
                <TableHeadCell>Date</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {isLoadingActivity ? (
                <TableBodyRow>
                  <TableBodyCell colSpan={4} className='text-center'>
                    <span className='flex items-center justify-center py-4'>
                      <Loader className='h-5 w-5 animate-spin' />
                    </span>
                  </TableBodyCell>
                </TableBodyRow>
              ) : interactions.length > 0 ? (
                interactions.map((interaction) => (
                  <TableBodyRow key={interaction.id}>
                    <TableBodyCell>
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-medium ${
                          interaction.type === 'upload'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        }`}
                      >
                        {interaction.type === 'upload' ? (
                          <Upload className='h-3 w-3' />
                        ) : (
                          <Download className='h-3 w-3' />
                        )}
                        {interaction.type}
                      </span>
                    </TableBodyCell>
                    <TableBodyCell className='text-xs'>
                      {interaction.cid ? (
                        <Link
                          href={ROUTES.objectDetails(
                            network.id,
                            interaction.cid,
                          )}
                          className='flex flex-col text-blue-600 hover:underline dark:text-blue-400'
                          title={interaction.cid}
                        >
                          {interaction.name && (
                            <span className='text-sm'>{interaction.name}</span>
                          )}
                          <span className='font-mono'>
                            {interaction.cid.slice(0, 8)}…
                            {interaction.cid.slice(-6)}
                          </span>
                        </Link>
                      ) : (
                        <span className='text-gray-400'>—</span>
                      )}
                    </TableBodyCell>
                    <TableBodyCell className='font-medium'>
                      {formatBytes(Number(interaction.size))}
                    </TableBodyCell>
                    <TableBodyCell>
                      <span className='flex items-center gap-1 text-sm text-gray-500'>
                        <Calendar className='h-3 w-3' />
                        {dayjs(interaction.created_at).format(
                          'MMM D, YYYY h:mm A',
                        )}
                      </span>
                    </TableBodyCell>
                  </TableBodyRow>
                ))
              ) : (
                <TableBodyRow>
                  <TableBodyCell
                    colSpan={4}
                    className='py-6 text-center text-gray-500'
                  >
                    No activity found
                  </TableBodyCell>
                </TableBodyRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className='mt-4 flex items-center justify-between'>
            <p className='text-sm text-gray-500'>
              Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
              {Math.min(currentPage * itemsPerPage, totalInteractions)} of{' '}
              {totalInteractions} activities
            </p>
            <div className='flex gap-2'>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className='rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800'
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className='rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800'
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

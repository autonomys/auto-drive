'use client';

import { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import { gql, useApolloClient, ApolloError } from '@apollo/client';
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
import { UserRole } from '@auto-drive/models';
import { useUserStore } from 'globalStates/user';
import { useRouter } from 'next/navigation';

// GraphQL query for account details - try both id and organization_id
const GET_ACCOUNT_BY_ID = gql`
  query GetAccountById($id: String!) {
    accounts(
      where: { _or: [{ id: { _eq: $id } }, { organization_id: { _eq: $id } }] }
    ) {
      id
      organization_id
      model
      upload_limit
      download_limit
      created_at
      updated_at
    }
  }
`;

// GraphQL query for account interactions — includes cid (requires migration 20260227000000)
const GET_ACCOUNT_INTERACTIONS = gql`
  query GetAccountInteractions(
    $accountId: String!
    $limit: Int!
    $offset: Int!
  ) {
    interactions(
      where: { account_id: { _eq: $accountId } }
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
    interactions_aggregate(where: { account_id: { _eq: $accountId } }) {
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

// Fallback query used before the cid migration has been applied
const GET_ACCOUNT_INTERACTIONS_LEGACY = gql`
  query GetAccountInteractionsLegacy(
    $accountId: String!
    $limit: Int!
    $offset: Int!
  ) {
    interactions(
      where: { account_id: { _eq: $accountId } }
      order_by: { created_at: desc }
      limit: $limit
      offset: $offset
    ) {
      id
      type
      size
      created_at
    }
    interactions_aggregate(where: { account_id: { _eq: $accountId } }) {
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

type Account = {
  id: string;
  organization_id: string;
  model: string;
  upload_limit: number;
  download_limit: number;
  created_at: string;
  updated_at: string;
};

type Interaction = {
  id: string;
  type: 'upload' | 'download';
  size: string;
  cid: string | null;
  created_at: string;
};

type Props = {
  organizationId: string;
};

export const OrganizationDetails = ({ organizationId }: Props) => {
  const { network } = useNetwork();
  const router = useRouter();
  const user = useUserStore(({ user }) => user);
  const apolloClient = useApolloClient();

  const [account, setAccount] = useState<Account | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [totalInteractions, setTotalInteractions] = useState(0);
  const [uploadStats, setUploadStats] = useState({ count: 0, size: 0 });
  const [downloadStats, setDownloadStats] = useState({ count: 0, size: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Redirect non-admin users
  useEffect(() => {
    if (user && user.role !== UserRole.Admin) {
      router.push(ROUTES.drive(network.id));
    }
  }, [user, router, network.id]);

  const fetchInteractions = useCallback(
    async (accountId: string) => {
      const variables = {
        accountId,
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage,
      };

      // Try the query that includes cid first (requires migration 20260227000000).
      // Only fall back to the legacy query when Hasura rejects the cid field
      // (migration not yet applied). Any other error is re-thrown so it surfaces
      // to the caller rather than being silently swallowed.
      try {
        return await apolloClient.query({
          query: GET_ACCOUNT_INTERACTIONS,
          variables,
          fetchPolicy: 'network-only',
        });
      } catch (err) {
        const isMissingField =
          err instanceof ApolloError &&
          err.graphQLErrors.some((e) =>
            e.message.toLowerCase().includes("field 'cid'"),
          );
        if (!isMissingField) throw err;
        return await apolloClient.query({
          query: GET_ACCOUNT_INTERACTIONS_LEGACY,
          variables,
          fetchPolicy: 'network-only',
        });
      }
    },
    [apolloClient, currentPage],
  );

  const fetchAccountDetails = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch account by ID or organization_id
      const accountResult = await apolloClient.query({
        query: GET_ACCOUNT_BY_ID,
        variables: { id: organizationId },
        fetchPolicy: 'network-only',
      });

      const accountData = accountResult.data?.accounts?.[0];
      setAccount(accountData || null);

      // Use the account.id for interactions query (organizationId param might be account.id or organization_id)
      const accountIdForInteractions = accountData?.id || organizationId;

      // Fetch interactions (with automatic fallback if cid column isn't migrated yet)
      const interactionsResult = await fetchInteractions(
        accountIdForInteractions,
      );

      setInteractions(
        (interactionsResult.data?.interactions || []).map(
          (i: Omit<Interaction, 'cid'> & { cid?: string | null }) => ({
            ...i,
            cid: i.cid ?? null,
          }),
        ),
      );
      setTotalInteractions(
        interactionsResult.data?.interactions_aggregate?.aggregate?.count || 0,
      );
      setUploadStats({
        count: interactionsResult.data?.upload_stats?.aggregate?.count || 0,
        size: Number(
          interactionsResult.data?.upload_stats?.aggregate?.sum?.size || 0,
        ),
      });
      setDownloadStats({
        count: interactionsResult.data?.download_stats?.aggregate?.count || 0,
        size: Number(
          interactionsResult.data?.download_stats?.aggregate?.sum?.size || 0,
        ),
      });
    } catch (error) {
      console.error('Error fetching account details:', error);
    } finally {
      setIsLoading(false);
    }
  }, [apolloClient, organizationId, fetchInteractions]);

  useEffect(() => {
    fetchAccountDetails();
  }, [fetchAccountDetails]);

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
          Organization Details
        </h1>

        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader className='h-6 w-6 animate-spin' />
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
            <div className='rounded-lg border border-gray-200 p-4'>
              <p className='text-xs text-gray-500'>Organization ID</p>
              <p className='mt-1 break-all font-mono text-sm'>
                {organizationId}
              </p>
            </div>
            {account && (
              <>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Account ID</p>
                  <p className='mt-1 break-all font-mono text-sm'>
                    {account.id}
                  </p>
                </div>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Model</p>
                  <p className='mt-1 font-medium capitalize'>{account.model}</p>
                </div>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Upload Limit</p>
                  <p className='mt-1 font-medium'>
                    {formatBytes(Number(account.upload_limit))}
                  </p>
                </div>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Download Limit</p>
                  <p className='mt-1 font-medium'>
                    {formatBytes(Number(account.download_limit))}
                  </p>
                </div>
                <div className='rounded-lg border border-gray-200 p-4'>
                  <p className='text-xs text-gray-500'>Created</p>
                  <p className='mt-1 font-medium'>
                    {account.created_at
                      ? dayjs(account.created_at).format('MMM D, YYYY')
                      : 'N/A'}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

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
        <h2 className='mb-4 flex items-center gap-2 text-lg font-semibold'>
          <Clock className='h-5 w-5' />
          Activity Log
        </h2>
        <div className='overflow-hidden rounded-lg border border-gray-200'>
          <Table className='min-w-full'>
            <TableHead>
              <TableHeadRow>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell>File (CID)</TableHeadCell>
                <TableHeadCell>Size</TableHeadCell>
                <TableHeadCell>Date</TableHeadCell>
              </TableHeadRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
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
                    <TableBodyCell className='font-mono text-xs'>
                      {interaction.cid ? (
                        <Link
                          href={ROUTES.objectDetails(
                            network.id,
                            interaction.cid,
                          )}
                          className='text-blue-600 hover:underline dark:text-blue-400'
                          title={interaction.cid}
                        >
                          {interaction.cid.slice(0, 8)}…
                          {interaction.cid.slice(-6)}
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


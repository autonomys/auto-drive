'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '@/utils/number';
import {
  Loader,
  TrendingUp,
  HardDrive,
  Download,
  Upload,
  Calendar,
  BarChart3,
  Trophy,
  Info,
  FileStack,
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
import { AccountModel } from '@auto-drive/models';
import Link from 'next/link';
import { useNetwork } from 'contexts/network';
import { ROUTES } from '@auto-drive/ui';

// GraphQL query for stats
const GET_ALL_STATS = gql`
  query GetAllStats($fromDate: timestamptz!, $toDate: timestamptz!) {
    upload_stats: interactions_aggregate(
      where: {
        type: { _eq: "upload" }
        created_at: { _gte: $fromDate, _lte: $toDate }
      }
    ) {
      aggregate {
        count
        sum {
          size
        }
      }
    }
    download_stats: interactions_aggregate(
      where: {
        type: { _eq: "download" }
        created_at: { _gte: $fromDate, _lte: $toDate }
      }
    ) {
      aggregate {
        count
        sum {
          size
        }
      }
    }
    total_files: metadata_roots_aggregate(
      where: { created_at: { _gte: $fromDate, _lte: $toDate } }
    ) {
      aggregate {
        count
      }
    }
  }
`;

// GraphQL query to get interactions for top accounts calculation
const GET_INTERACTIONS_FOR_RANKING = gql`
  query GetInteractionsForRanking(
    $type: String!
    $fromDate: timestamptz!
    $toDate: timestamptz!
  ) {
    interactions(
      where: {
        type: { _eq: $type }
        created_at: { _gte: $fromDate, _lte: $toDate }
      }
    ) {
      account_id
      size
    }
  }
`;

type DateRange = {
  from: Date;
  to: Date;
};

type Stats = {
  uploadCount: number;
  uploadSize: number;
  downloadCount: number;
  downloadSize: number;
  totalFiles: number;
};

type RankingAccount = {
  id: string;
  organizationId: string;
  totalSize: number;
  uploadLimit: number;
  downloadLimit: number;
  model: AccountModel;
};

export const AdminStats = () => {
  const { network } = useNetwork();
  const [stats, setStats] = useState<Stats | null>(null);
  const [topUploaders, setTopUploaders] = useState<RankingAccount[]>([]);
  const [topDownloaders, setTopDownloaders] = useState<RankingAccount[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isLoadingRanking, setIsLoadingRanking] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: dayjs().subtract(30, 'day').startOf('day').toDate(),
    to: dayjs().endOf('day').toDate(),
  });

  const apolloClient = useApolloClient();

  // Fetch stats from GraphQL
  const fetchStats = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      const result = await apolloClient.query({
        query: GET_ALL_STATS,
        variables: {
          fromDate: dateRange.from.toISOString(),
          toDate: dateRange.to.toISOString(),
        },
        fetchPolicy: 'network-only',
      });

      const uploadStats = result.data?.upload_stats?.aggregate;
      const downloadStats = result.data?.download_stats?.aggregate;

      const totalFiles = result.data?.total_files?.aggregate;

      setStats({
        uploadCount: uploadStats?.count ?? 0,
        uploadSize: Number(uploadStats?.sum?.size ?? 0),
        downloadCount: downloadStats?.count ?? 0,
        downloadSize: Number(downloadStats?.sum?.size ?? 0),
        totalFiles: totalFiles?.count ?? 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  }, [apolloClient, dateRange]);

  // Helper function to aggregate interactions by account
  const aggregateByAccount = (
    interactions: Array<{ account_id: string; size: string | number }>,
  ): RankingAccount[] => {
    const accountTotals = new Map<string, number>();

    for (const interaction of interactions) {
      const currentTotal = accountTotals.get(interaction.account_id) || 0;
      accountTotals.set(
        interaction.account_id,
        currentTotal + Number(interaction.size),
      );
    }

    // Convert to array, sort by totalSize descending, take top 10
    const sorted = Array.from(accountTotals.entries())
      .map(([accountId, totalSize]) => ({
        id: accountId,
        organizationId: accountId, // Using account_id as organizationId for display
        totalSize,
        uploadLimit: 0,
        downloadLimit: 0,
        model: AccountModel.Monthly,
      }))
      .sort((a, b) => b.totalSize - a.totalSize)
      .slice(0, 10);

    return sorted;
  };

  // Fetch top accounts via GraphQL
  const fetchTopAccounts = useCallback(async () => {
    setIsLoadingRanking(true);
    try {
      const [uploadersResult, downloadersResult] = await Promise.all([
        apolloClient.query({
          query: GET_INTERACTIONS_FOR_RANKING,
          variables: {
            type: 'upload',
            fromDate: dateRange.from.toISOString(),
            toDate: dateRange.to.toISOString(),
          },
          fetchPolicy: 'network-only',
        }),
        apolloClient.query({
          query: GET_INTERACTIONS_FOR_RANKING,
          variables: {
            type: 'download',
            fromDate: dateRange.from.toISOString(),
            toDate: dateRange.to.toISOString(),
          },
          fetchPolicy: 'network-only',
        }),
      ]);

      const uploadInteractions = uploadersResult.data?.interactions || [];
      const downloadInteractions = downloadersResult.data?.interactions || [];

      setTopUploaders(aggregateByAccount(uploadInteractions));
      setTopDownloaders(aggregateByAccount(downloadInteractions));
    } catch (error) {
      console.error('Error fetching top accounts:', error);
    } finally {
      setIsLoadingRanking(false);
    }
  }, [apolloClient, dateRange]);

  useEffect(() => {
    fetchStats();
    fetchTopAccounts();
  }, [fetchStats, fetchTopAccounts]);

  const handleFromDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value
      ? dayjs(e.target.value).startOf('day').toDate()
      : dayjs().subtract(30, 'day').startOf('day').toDate();
    setDateRange((prev) => ({ ...prev, from: date }));
  };

  const handleToDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value
      ? dayjs(e.target.value).endOf('day').toDate()
      : dayjs().endOf('day').toDate();
    setDateRange((prev) => ({ ...prev, to: date }));
  };

  const setPresetRange = (days: number) => {
    setDateRange({
      from: dayjs().subtract(days, 'day').startOf('day').toDate(),
      to: dayjs().endOf('day').toDate(),
    });
  };

  const getMedalColor = (rank: number) => {
    switch (rank) {
      case 1:
        return 'text-yellow-500';
      case 2:
        return 'text-gray-400';
      case 3:
        return 'text-amber-600';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className='space-y-6'>
      {/* Date Range Selector */}
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-4 flex items-center gap-2 text-lg font-semibold'>
          <BarChart3 className='h-5 w-5' />
          Analytics Period
        </h2>
        <div className='flex flex-wrap items-end gap-4'>
          <div className='flex flex-col'>
            <label
              htmlFor='date-from'
              className='mb-1 flex items-center gap-1 text-sm text-gray-500'
            >
              <Calendar className='h-4 w-4' />
              From
            </label>
            <input
              id='date-from'
              type='date'
              value={dayjs(dateRange.from).format('YYYY-MM-DD')}
              onChange={handleFromDateChange}
              className='rounded border border-gray-300 bg-background-hover px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'
            />
          </div>
          <div className='flex flex-col'>
            <label
              htmlFor='date-to'
              className='mb-1 flex items-center gap-1 text-sm text-gray-500'
            >
              <Calendar className='h-4 w-4' />
              To
            </label>
            <input
              id='date-to'
              type='date'
              value={dayjs(dateRange.to).format('YYYY-MM-DD')}
              onChange={handleToDateChange}
              className='rounded border border-gray-300 bg-background-hover px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'
            />
          </div>
          <div className='flex gap-2'>
            <button
              onClick={() => setPresetRange(7)}
              className='rounded border border-gray-300 bg-background-hover px-3 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-700'
            >
              7 days
            </button>
            <button
              onClick={() => setPresetRange(30)}
              className='rounded border border-gray-300 bg-background-hover px-3 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-700'
            >
              30 days
            </button>
            <button
              onClick={() => setPresetRange(90)}
              className='rounded border border-gray-300 bg-background-hover px-3 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-700'
            >
              90 days
            </button>
            <button
              onClick={() =>
                setDateRange({
                  from: dayjs('2025-03-01').startOf('day').toDate(),
                  to: dayjs().endOf('day').toDate(),
                })
              }
              className='rounded border border-gray-300 bg-background-hover px-3 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-700'
            >
              All time
            </button>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-4 flex items-center gap-2 text-lg font-semibold'>
          <TrendingUp className='h-5 w-5' />
          Statistics
        </h2>
        {isLoadingStats ? (
          <div className='flex items-center justify-center py-8'>
            <Loader className='h-6 w-6 animate-spin' />
          </div>
        ) : stats ? (
          <>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5'>
              {/* Total Files */}
              <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 dark:from-indigo-900/20 dark:to-indigo-800/20'>
                <div className='flex items-center gap-3'>
                  <div className='rounded-lg bg-indigo-500 p-2'>
                    <FileStack className='h-5 w-5 text-white' />
                  </div>
                  <div>
                    <p className='text-xs text-gray-500 dark:text-gray-400'>
                      Total Files
                    </p>
                    <p className='text-2xl font-bold text-indigo-600 dark:text-indigo-400'>
                      {stats.totalFiles.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
              {/* Upload Count */}
              <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4 dark:from-blue-900/20 dark:to-blue-800/20'>
                <div className='flex items-center gap-3'>
                  <div className='rounded-lg bg-blue-500 p-2'>
                    <Upload className='h-5 w-5 text-white' />
                  </div>
                  <div>
                    <p className='text-xs text-gray-500 dark:text-gray-400'>
                      Tracked Uploads
                    </p>
                    <p className='text-2xl font-bold text-blue-600 dark:text-blue-400'>
                      {stats.uploadCount.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            {/* Upload Size */}
            <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 dark:from-emerald-900/20 dark:to-emerald-800/20'>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-emerald-500 p-2'>
                  <HardDrive className='h-5 w-5 text-white' />
                </div>
                <div>
                  <p className='text-xs text-gray-500 dark:text-gray-400'>
                    Upload Size
                  </p>
                  <p className='text-2xl font-bold text-emerald-600 dark:text-emerald-400'>
                    {formatBytes(stats.uploadSize)}
                  </p>
                </div>
              </div>
            </div>
            {/* Download Count */}
            <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4 dark:from-purple-900/20 dark:to-purple-800/20'>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-purple-500 p-2'>
                  <Download className='h-5 w-5 text-white' />
                </div>
                <div>
                  <p className='text-xs text-gray-500 dark:text-gray-400'>
                    Downloads
                  </p>
                  <p className='text-2xl font-bold text-purple-600 dark:text-purple-400'>
                    {stats.downloadCount.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
            {/* Download Size */}
            <div className='rounded-lg border border-gray-200 bg-gradient-to-br from-orange-50 to-orange-100 p-4 dark:from-orange-900/20 dark:to-orange-800/20'>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-orange-500 p-2'>
                  <HardDrive className='h-5 w-5 text-white' />
                </div>
                <div>
                  <p className='text-xs text-gray-500 dark:text-gray-400'>
                    Download Size
                  </p>
                  <p className='text-2xl font-bold text-orange-600 dark:text-orange-400'>
                    {formatBytes(stats.downloadSize)}
                  </p>
                </div>
              </div>
            </div>
            </div>

            {/* Info box explaining the difference */}
            {stats.totalFiles !== stats.uploadCount && (
              <div className='mt-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20'>
                <Info className='mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500' />
                <div className='text-sm text-blue-700 dark:text-blue-300'>
                  <p className='font-medium'>
                    Why is Total Files different from Tracked Uploads?
                  </p>
                  <ul className='mt-1 list-inside list-disc space-y-1 text-blue-600 dark:text-blue-400'>
                    <li>
                      <strong>Total Files</strong>: All files and folders stored
                      in the system, including files inside folder uploads
                    </li>
                    <li>
                      <strong>Tracked Uploads</strong>: Individual file upload
                      events that were tracked (folder uploads are not currently
                      tracked as separate events)
                    </li>
                    <li>
                      A folder with 100 files creates 101 file entries but 0
                      tracked upload events
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className='text-center text-gray-500'>No data available</p>
        )}
      </div>

      {/* Top Accounts Tables */}
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-4 flex items-center gap-2 text-lg font-semibold'>
          <Trophy className='h-5 w-5 text-yellow-500' />
          Top 10 Accounts
        </h2>
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
          {/* Top Uploaders */}
          <div>
            <h3 className='mb-3 flex items-center gap-2 text-base font-medium'>
              <Upload className='h-4 w-4 text-blue-500' />
              Top Uploaders
            </h3>
            <div className='overflow-hidden rounded-lg border border-gray-200'>
              <Table className='min-w-full'>
                <TableHead>
                  <TableHeadRow>
                    <TableHeadCell>Rank</TableHeadCell>
                    <TableHeadCell>Organization</TableHeadCell>
                    <TableHeadCell>Size</TableHeadCell>
                  </TableHeadRow>
                </TableHead>
                <TableBody>
                  {isLoadingRanking ? (
                    <TableBodyRow>
                      <TableBodyCell colSpan={3} className='text-center'>
                        <span className='flex items-center justify-center py-4'>
                          <Loader className='h-5 w-5 animate-spin' />
                        </span>
                      </TableBodyCell>
                    </TableBodyRow>
                  ) : topUploaders.length > 0 ? (
                    topUploaders.map((account, index) => (
                      <TableBodyRow key={account.id}>
                        <TableBodyCell className='font-medium'>
                          <span
                            className={`flex items-center gap-2 ${getMedalColor(index + 1)}`}
                          >
                            {index < 3 && <Trophy className='h-4 w-4' />}
                            #{index + 1}
                          </span>
                        </TableBodyCell>
                        <TableBodyCell className='font-mono text-xs'>
                          <Link
                            href={ROUTES.adminOrganization(
                              network.id,
                              account.id,
                            )}
                            className='text-blue-600 hover:underline dark:text-blue-400'
                          >
                            {account.organizationId.slice(0, 6)}...
                            {account.organizationId.slice(-4)}
                          </Link>
                        </TableBodyCell>
                        <TableBodyCell className='font-semibold'>
                          {formatBytes(account.totalSize)}
                        </TableBodyCell>
                      </TableBodyRow>
                    ))
                  ) : (
                    <TableBodyRow>
                      <TableBodyCell
                        colSpan={3}
                        className='py-6 text-center text-gray-500'
                      >
                        No data available
                      </TableBodyCell>
                    </TableBodyRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Top Downloaders */}
          <div>
            <h3 className='mb-3 flex items-center gap-2 text-base font-medium'>
              <Download className='h-4 w-4 text-emerald-500' />
              Top Downloaders
            </h3>
            <div className='overflow-hidden rounded-lg border border-gray-200'>
              <Table className='min-w-full'>
                <TableHead>
                  <TableHeadRow>
                    <TableHeadCell>Rank</TableHeadCell>
                    <TableHeadCell>Organization</TableHeadCell>
                    <TableHeadCell>Size</TableHeadCell>
                  </TableHeadRow>
                </TableHead>
                <TableBody>
                  {isLoadingRanking ? (
                    <TableBodyRow>
                      <TableBodyCell colSpan={3} className='text-center'>
                        <span className='flex items-center justify-center py-4'>
                          <Loader className='h-5 w-5 animate-spin' />
                        </span>
                      </TableBodyCell>
                    </TableBodyRow>
                  ) : topDownloaders.length > 0 ? (
                    topDownloaders.map((account, index) => (
                      <TableBodyRow key={account.id}>
                        <TableBodyCell className='font-medium'>
                          <span
                            className={`flex items-center gap-2 ${getMedalColor(index + 1)}`}
                          >
                            {index < 3 && <Trophy className='h-4 w-4' />}
                            #{index + 1}
                          </span>
                        </TableBodyCell>
                        <TableBodyCell className='font-mono text-xs'>
                          <Link
                            href={ROUTES.adminOrganization(
                              network.id,
                              account.id,
                            )}
                            className='text-blue-600 hover:underline dark:text-blue-400'
                          >
                            {account.organizationId.slice(0, 6)}...
                            {account.organizationId.slice(-4)}
                          </Link>
                        </TableBodyCell>
                        <TableBodyCell className='font-semibold'>
                          {formatBytes(account.totalSize)}
                        </TableBodyCell>
                      </TableBodyRow>
                    ))
                  ) : (
                    <TableBodyRow>
                      <TableBodyCell
                        colSpan={3}
                        className='py-6 text-center text-gray-500'
                      >
                        No data available
                      </TableBodyCell>
                    </TableBodyRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader } from 'lucide-react';
import { ROUTES } from '@auto-drive/ui';
import { AccountUsageSummary } from '@auto-drive/models';
import { useNetwork } from '@/contexts/network';
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
import { UsageDaysPicker } from '@/components/views/UsageReport/UsageDaysPicker';
import { formatBytes } from '@/utils/number';
import { formatCid } from '@/utils/table';
import { formatAi3 } from '@/utils/credits';
import { defaultUsageDays, toUsageRange, UsageDays } from '@/utils/usageReport';

const bytes = (value: string) => formatBytes(Number(value));

/** Admin: each account active in a range, most upload bytes first. */
export const AccountUsageList = () => {
  const { api, network } = useNetwork();
  const [days, setDays] = useState<UsageDays>(defaultUsageDays);
  const [partnersOnly, setPartnersOnly] = useState(true);
  const range = useMemo(() => toUsageRange(days), [days]);

  const {
    data: accounts,
    isLoading,
    error,
  } = useQuery<AccountUsageSummary[]>({
    queryKey: ['adminAccountUsage', range?.from, range?.to, partnersOnly],
    queryFn: () =>
      api.adminGetAccountUsage(range!.from, range!.to, partnersOnly),
    enabled: range !== null,
    staleTime: 60_000,
  });

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-4'>
        <UsageDaysPicker days={days} onChange={setDays} />
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={partnersOnly}
            onChange={(e) => setPartnersOnly(e.target.checked)}
          />
          Partners only
        </label>
      </div>
      <div className='overflow-x-auto'>
        <Table className='min-w-full'>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>Account</TableHeadCell>
              <TableHeadCell>Uploads</TableHeadCell>
              <TableHeadCell>Upload size</TableHeadCell>
              <TableHeadCell>AI3 value</TableHeadCell>
              <TableHeadCell>Download size</TableHeadCell>
              <TableHeadCell>Credits granted</TableHeadCell>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {!range || isLoading || error || !accounts?.length ? (
              <TableBodyRow>
                <TableBodyCell
                  colSpan={6}
                  className='py-6 text-center text-gray-500'
                >
                  {!range ? (
                    'Pick a start and end day.'
                  ) : isLoading ? (
                    <Loader className='mx-auto h-5 w-5 animate-spin' />
                  ) : error ? (
                    'Usage is unavailable.'
                  ) : (
                    'No activity in this range'
                  )}
                </TableBodyCell>
              </TableBodyRow>
            ) : (
              accounts.map((account) => (
                <TableBodyRow key={account.accountId}>
                  <TableBodyCell>
                    <Link
                      href={ROUTES.adminOrganization(
                        network.id,
                        account.accountId,
                      )}
                      className='flex items-center gap-2 text-blue-600 hover:underline dark:text-blue-400'
                    >
                      {account.organizationName ?? (
                        <span className='font-mono text-xs'>
                          {formatCid(account.accountId)}
                        </span>
                      )}
                      {account.isPartner && (
                        <span className='rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800'>
                          Partner
                        </span>
                      )}
                    </Link>
                  </TableBodyCell>
                  <TableBodyCell>
                    {account.uploadCount.toLocaleString()}
                  </TableBodyCell>
                  <TableBodyCell>{bytes(account.uploadBytes)}</TableBodyCell>
                  <TableBodyCell>
                    {formatAi3(BigInt(account.ai3Value))}
                  </TableBodyCell>
                  <TableBodyCell>{bytes(account.downloadBytes)}</TableBodyCell>
                  <TableBodyCell>{bytes(account.grantedBytes)}</TableBodyCell>
                </TableBodyRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

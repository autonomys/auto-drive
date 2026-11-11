'use client';

import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Download, Loader } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import { UsageByApiKey, UsageReport } from '@auto-drive/models';
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
import { formatBytes } from '@/utils/number';
import { formatCid } from '@/utils/table';
import { describePayment, formatAi3 } from '@/utils/credits';
import { useDebounce } from '@/hooks/useDebounce';
import {
  defaultUsageDays,
  firstDayFrom,
  toUsageRange,
  USAGE_DAYS_DEBOUNCE_MS,
  UsageDays,
} from '@/utils/usageReport';
import { UsageDaysPicker } from './UsageDaysPicker';

const bytes = (value: string) => formatBytes(Number(value));
const ai3 = (shannons: string) => formatAi3(BigInt(shannons));
// Report ranges are whole UTC days, so dates show the UTC calendar day.
dayjs.extend(utc);
const day = (iso: string) => dayjs.utc(iso).format('MMM D, YYYY');

const EXPORTS = [
  { label: 'Summary', table: 'summary' },
  { label: 'API keys', table: 'apiKeys' },
  { label: 'Purchases', table: 'purchases' },
  { label: 'Interactions', table: 'interactions' },
  { label: 'JSON', table: 'report' },
] as const;

type ExportTable = (typeof EXPORTS)[number]['table'];

const Stat = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) => (
  <div className='rounded-lg border border-gray-200 p-4'>
    <p className='text-xs text-gray-500'>{label}</p>
    <p className='mt-1 font-medium'>{value}</p>
    {hint && <p className='mt-1 text-xs text-gray-500'>{hint}</p>}
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div>
    <h3 className='mb-3 text-sm font-medium uppercase tracking-wide text-gray-500'>
      {title}
    </h3>
    {children}
  </div>
);

const KeyLabel = ({ row }: { row: UsageByApiKey }) => {
  if (row.kind === 'session') return <>Web app</>;
  if (row.kind === 'unattributed') {
    return <span className='text-gray-500'>Before attribution</span>;
  }
  return (
    <span className='flex items-center gap-2'>
      {row.name ?? (
        <span className='font-mono text-xs'>{formatCid(row.apiKeyId!)}</span>
      )}
      {row.deleted && (
        <span className='rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
          Deleted
        </span>
      )}
    </span>
  );
};

const Balance = ({ report }: { report: UsageReport }) => {
  const { balance, attributionStart } = report;
  if (!balance) {
    return (
      <p className='text-sm text-gray-500'>
        {attributionStart
          ? `Credit balances are available for ranges starting on or after ${firstDayFrom(attributionStart)}.`
          : 'Credit balances are not available yet.'}
      </p>
    );
  }
  return (
    <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6'>
      <Stat label='Opening' value={bytes(balance.opening)} />
      <Stat label='Granted' value={`+ ${bytes(balance.granted)}`} />
      <Stat label='Consumed' value={`− ${bytes(balance.consumed)}`} />
      <Stat label='Expired' value={`− ${bytes(balance.expired)}`} />
      <Stat label='Refunded' value={`− ${bytes(balance.refunded)}`} />
      <Stat label='Closing' value={bytes(balance.closing)} />
    </div>
  );
};

const ApiKeysTable = ({ rows }: { rows: UsageByApiKey[] }) => (
  <div className='overflow-x-auto'>
    <Table className='min-w-full'>
      <TableHead>
        <TableHeadRow>
          <TableHeadCell>Key</TableHeadCell>
          <TableHeadCell>Uploads</TableHeadCell>
          <TableHeadCell>Upload size</TableHeadCell>
          <TableHeadCell>Purchased</TableHeadCell>
          <TableHeadCell>AI3 value</TableHeadCell>
          <TableHeadCell>Downloads</TableHeadCell>
          <TableHeadCell>Download size</TableHeadCell>
        </TableHeadRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableBodyRow key={`${row.kind}:${row.apiKeyId ?? ''}`}>
            <TableBodyCell>
              <KeyLabel row={row} />
            </TableBodyCell>
            <TableBodyCell>{row.uploadCount.toLocaleString()}</TableBodyCell>
            <TableBodyCell>{bytes(row.uploadBytes)}</TableBodyCell>
            <TableBodyCell>{bytes(row.purchasedBytes)}</TableBodyCell>
            <TableBodyCell>{ai3(row.ai3Value)}</TableBodyCell>
            <TableBodyCell>{row.downloadCount.toLocaleString()}</TableBodyCell>
            <TableBodyCell>{bytes(row.downloadBytes)}</TableBodyCell>
          </TableBodyRow>
        ))}
        {rows.length === 0 && (
          <TableBodyRow>
            <TableBodyCell
              colSpan={7}
              className='py-6 text-center text-gray-500'
            >
              No activity in this range
            </TableBodyCell>
          </TableBodyRow>
        )}
      </TableBody>
    </Table>
  </div>
);

const PurchasesTable = ({ report }: { report: UsageReport }) => (
  <div className='overflow-x-auto'>
    <Table className='min-w-full'>
      <TableHead>
        <TableHeadRow>
          <TableHeadCell>Granted</TableHeadCell>
          <TableHeadCell>Buyer</TableHeadCell>
          <TableHeadCell>Size</TableHeadCell>
          <TableHeadCell>Paid</TableHeadCell>
          <TableHeadCell>Expires</TableHeadCell>
          <TableHeadCell>Refunded</TableHeadCell>
        </TableHeadRow>
      </TableHead>
      <TableBody>
        {report.purchases.map((purchase) => {
          const payment = describePayment(purchase);
          return (
            <TableBodyRow key={purchase.batchId}>
              <TableBodyCell>{day(purchase.grantedAt)}</TableBodyCell>
              <TableBodyCell className='font-mono text-xs'>
                {formatCid(purchase.buyer)}
              </TableBodyCell>
              <TableBodyCell>{bytes(purchase.bytes)}</TableBodyCell>
              <TableBodyCell>
                {payment.amountPaid}
                {payment.rate && (
                  <span className='block text-xs text-gray-500'>
                    {payment.rate}
                  </span>
                )}
              </TableBodyCell>
              <TableBodyCell>{day(purchase.expiresAt)}</TableBodyCell>
              <TableBodyCell>
                {purchase.refundedAt ? (
                  <>
                    {day(purchase.refundedAt)}
                    {purchase.refundedBytes !== null && (
                      <span className='block text-xs text-gray-500'>
                        {bytes(purchase.refundedBytes)}
                      </span>
                    )}
                  </>
                ) : (
                  '—'
                )}
              </TableBodyCell>
            </TableBodyRow>
          );
        })}
        {report.purchases.length === 0 && (
          <TableBodyRow>
            <TableBodyCell
              colSpan={6}
              className='py-6 text-center text-gray-500'
            >
              No credits granted in this range
            </TableBodyCell>
          </TableBodyRow>
        )}
      </TableBody>
    </Table>
  </div>
);

/**
 * An account's usage over whole UTC days: uploads and downloads, split by API
 * key, with the credits granted and the purchased-credit balance.
 */
export const UsageReportView = ({ accountId }: { accountId: string }) => {
  const { api } = useNetwork();
  const [days, setDays] = useState<UsageDays>(defaultUsageDays);
  // A date input emits each partial year while one is typed (0002, 0020…),
  // so only a range that has settled is requested.
  const settledDays = useDebounce(days, USAGE_DAYS_DEBOUNCE_MS);
  const range = useMemo(() => toUsageRange(settledDays), [settledDays]);
  const [exporting, setExporting] = useState<ExportTable | null>(null);

  const {
    data: report,
    isLoading,
    error,
  } = useQuery<UsageReport>({
    queryKey: ['usageReport', accountId, range?.from, range?.to],
    queryFn: () => api.getUsageReport(accountId, range!.from, range!.to),
    enabled: range !== null,
    staleTime: 60_000,
  });

  const download = async (table: ExportTable) => {
    if (!range) return;
    const name = `usage-${accountId}-${settledDays.from}-to-${settledDays.through}-${table}`;
    setExporting(table);
    try {
      if (table === 'interactions') {
        await api.downloadUsageExport(
          accountId,
          'usage-report/interactions',
          { ...range, format: 'csv' },
          `${name}.csv`,
        );
      } else if (table === 'report') {
        await api.downloadUsageExport(
          accountId,
          'usage-report',
          { ...range, format: 'json' },
          `${name}.json`,
        );
      } else {
        await api.downloadUsageExport(
          accountId,
          'usage-report',
          { ...range, format: 'csv', table },
          `${name}.csv`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const unattributed = report ? BigInt(report.uploads.unattributedBytes) : null;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <UsageDaysPicker days={days} onChange={setDays} />
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-xs text-gray-500'>Export</span>
          {EXPORTS.map(({ label, table }) => (
            <Button
              key={table}
              variant='outline'
              size='sm'
              disabled={!range || exporting !== null}
              onClick={() => download(table)}
            >
              {exporting === table ? (
                <Loader className='animate-spin' />
              ) : (
                <Download />
              )}
              {label}
            </Button>
          ))}
        </div>
      </div>

      {!range ? (
        <p className='text-sm text-gray-500'>Pick a start and end day.</p>
      ) : isLoading ? (
        <div className='flex items-center justify-center py-8'>
          <Loader className='h-6 w-6 animate-spin' />
        </div>
      ) : error || !report ? (
        <p className='text-sm text-gray-500'>
          {error instanceof Error ? error.message : 'Usage is unavailable.'}
        </p>
      ) : (
        <>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
            <Stat
              label='Uploads'
              value={bytes(report.uploads.bytes)}
              hint={`${report.uploads.count.toLocaleString()} uploads`}
            />
            <Stat
              label='Paid with purchased credits'
              value={bytes(report.uploads.purchasedBytes)}
              hint={`${bytes(report.uploads.freeTierBytes)} free tier`}
            />
            <Stat
              label='AI3 value'
              value={ai3(report.uploads.ai3Value)}
              hint='At the price of the credits used'
            />
            <Stat
              label='Downloads'
              value={bytes(report.downloads.bytes)}
              hint={`${report.downloads.count.toLocaleString()} downloads`}
            />
          </div>
          {unattributed !== null && unattributed > BigInt(0) && (
            <p className='text-xs text-gray-500'>
              {bytes(report.uploads.unattributedBytes)} of purchased uploads
              predate attribution, so their credit batches and AI3 value are
              unknown.
            </p>
          )}

          <Section title='Purchased credit balance'>
            <Balance report={report} />
          </Section>

          <Section title='By API key'>
            <ApiKeysTable rows={report.apiKeys} />
          </Section>

          <Section title='Credits granted'>
            <PurchasesTable report={report} />
          </Section>
        </>
      )}
    </div>
  );
};

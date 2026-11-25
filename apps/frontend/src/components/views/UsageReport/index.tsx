'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ChevronDown, Download, Loader } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import {
  CreditBalance,
  UsageByApiKey,
  UsageByCustomerReference,
  UsageFreeCreditChange,
  UsageReport,
} from '@auto-drive/models';
import { useNetwork } from '@/contexts/network';
import { useUserStore } from '@/globalStates/user';
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
import { formatStorageSize } from '@/utils/number';
import { formatCid } from '@/utils/table';
import {
  describeFreeCreditChange,
  describePayment,
  formatAi3,
} from '@/utils/credits';
import { useDebounce } from '@/hooks/useDebounce';
import {
  defaultUsageDays,
  firstDayFrom,
  toUsageRange,
  USAGE_DAYS_DEBOUNCE_MS,
  UsageDays,
} from '@/utils/usageReport';
import { UsageDaysPicker } from './UsageDaysPicker';

const bytes = (value: string) => formatStorageSize(Number(value));
const ai3 = (shannons: string) => formatAi3(BigInt(shannons));
// Report ranges are whole UTC days, so dates show the UTC calendar day.
dayjs.extend(utc);
const day = (iso: string) => dayjs.utc(iso).format('MMM D, YYYY');
const ZERO = BigInt(0);
// A change in bytes, with its sign.
const signed = (value: string) => {
  const n = BigInt(value);
  if (n === ZERO) return bytes('0');
  return `${n > ZERO ? '+' : '−'} ${bytes((n < ZERO ? -n : n).toString())}`;
};

const EXPORTS = [
  { label: 'Summary', table: 'summary' },
  { label: 'API keys', table: 'apiKeys' },
  { label: 'Customer references', table: 'customerReferences' },
  { label: 'Purchases', table: 'purchases' },
  { label: 'Free credit batches', table: 'freeCredits' },
  { label: 'Interactions', table: 'interactions' },
  { label: 'Full report (JSON)', table: 'report' },
] as const;

type ExportTable = (typeof EXPORTS)[number]['table'];

// One menu instead of a button per table, which crowded the page.
const ExportMenu = ({
  exports,
  disabled,
  exporting,
  onExport,
}: {
  exports: readonly { label: string; table: ExportTable }[];
  disabled: boolean;
  exporting: ExportTable | null;
  onExport: (table: ExportTable) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className='relative' ref={ref}>
      <Button
        variant='outline'
        size='sm'
        disabled={disabled || exporting !== null}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup='menu'
        aria-expanded={open}
      >
        {exporting ? <Loader className='animate-spin' /> : <Download />}
        Export
        <ChevronDown />
      </Button>
      {open && (
        <div
          role='menu'
          className='absolute right-0 z-20 mt-1 w-48 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg'
        >
          {exports.map(({ label, table }) => (
            <button
              key={table}
              role='menuitem'
              className='block w-full px-3 py-1.5 text-left hover:bg-background-hover'
              onClick={() => {
                setOpen(false);
                onExport(table);
              }}
            >
              {label}
              <span className='ml-1 text-xs text-gray-500'>
                {table === 'report' ? '' : 'CSV'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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
  if (row.kind === 'session') return <>Web app (all members)</>;
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

// Purchased and free credits are balanced apart, so neither is taken for the
// other.
const Balance = ({
  balance,
  attributionStart,
  free,
}: {
  balance: CreditBalance | null;
  attributionStart: string | null;
  free: boolean;
}) => {
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
      <Stat
        label={free ? 'Granted' : 'Purchased'}
        value={`+ ${bytes(balance.granted)}`}
        hint={free ? 'One-time grants and monthly issues' : undefined}
      />
      {free && (
        <Stat
          label='Adjusted'
          value={signed(balance.adjusted)}
          hint='Changes to the monthly amount'
        />
      )}
      <Stat label='Consumed' value={`− ${bytes(balance.consumed)}`} />
      <Stat
        label='Expired'
        value={`− ${bytes(balance.expired)}`}
        hint={free ? 'Ended unused' : undefined}
      />
      {!free && (
        <Stat label='Refunded' value={`− ${bytes(balance.refunded)}`} />
      )}
      <Stat label='Closing' value={bytes(balance.closing)} />
    </div>
  );
};

// A member's key shows its owner's Public ID, never their sign-in name.
const KeyOwner = ({ row }: { row: UsageByApiKey }) => {
  const viewerPublicId = useUserStore((state) => state.user?.publicId);
  if (row.owner === 'organization') return <>Organization</>;
  if (row.owner === 'member') {
    if (!row.ownerPublicId) return <>A member</>;
    if (row.ownerPublicId === viewerPublicId) return <>You</>;
    return (
      <span className='font-mono text-xs'>{formatCid(row.ownerPublicId)}</span>
    );
  }
  return <span className='text-gray-500'>—</span>;
};

const ApiKeysTable = ({ rows }: { rows: UsageByApiKey[] }) => (
  <div className='overflow-x-auto'>
    <Table className='min-w-full'>
      <TableHead>
        <TableHeadRow>
          <TableHeadCell>Key</TableHeadCell>
          <TableHeadCell>Owner</TableHeadCell>
          <TableHeadCell>Uploads</TableHeadCell>
          <TableHeadCell>Upload size</TableHeadCell>
          <TableHeadCell>Purchased</TableHeadCell>
          <TableHeadCell>Free credits</TableHeadCell>
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
            <TableBodyCell>
              <KeyOwner row={row} />
            </TableBodyCell>
            <TableBodyCell>{row.uploadCount.toLocaleString()}</TableBodyCell>
            <TableBodyCell>{bytes(row.uploadBytes)}</TableBodyCell>
            <TableBodyCell>{bytes(row.purchasedBytes)}</TableBodyCell>
            <TableBodyCell>{bytes(row.freeCreditBytes)}</TableBodyCell>
            <TableBodyCell>{ai3(row.ai3Value)}</TableBodyCell>
            <TableBodyCell>{row.downloadCount.toLocaleString()}</TableBodyCell>
            <TableBodyCell>{bytes(row.downloadBytes)}</TableBodyCell>
          </TableBodyRow>
        ))}
        {rows.length === 0 && (
          <TableBodyRow>
            <TableBodyCell
              colSpan={9}
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

const CustomerReferencesTable = ({
  rows,
}: {
  rows: UsageByCustomerReference[];
}) => (
  <div className='overflow-x-auto'>
    <Table className='min-w-full'>
      <TableHead>
        <TableHeadRow>
          <TableHeadCell>Customer reference</TableHeadCell>
          <TableHeadCell>Uploads</TableHeadCell>
          <TableHeadCell>Upload size</TableHeadCell>
          <TableHeadCell>Purchased</TableHeadCell>
          <TableHeadCell>Free credits</TableHeadCell>
          <TableHeadCell>AI3 value</TableHeadCell>
        </TableHeadRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableBodyRow key={row.customerReference ?? ''}>
            <TableBodyCell>
              {row.customerReference === null ? (
                <span className='text-gray-500'>No reference</span>
              ) : (
                <span className='font-mono text-xs'>
                  {row.customerReference}
                </span>
              )}
            </TableBodyCell>
            <TableBodyCell>{row.uploadCount.toLocaleString()}</TableBodyCell>
            <TableBodyCell>{bytes(row.uploadBytes)}</TableBodyCell>
            <TableBodyCell>{bytes(row.purchasedBytes)}</TableBodyCell>
            <TableBodyCell>{bytes(row.freeCreditBytes)}</TableBodyCell>
            <TableBodyCell>{ai3(row.ai3Value)}</TableBodyCell>
          </TableBodyRow>
        ))}
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
              No credits purchased in this range
            </TableBodyCell>
          </TableBodyRow>
        )}
      </TableBody>
    </Table>
  </div>
);

// Who granted the credits or changed the amount, and why, reach admins only.
const FreeCreditHistory = ({
  changes,
}: {
  changes: UsageFreeCreditChange[];
}) => {
  const admin = changes.some((change) => 'by' in change);
  return (
    <div className='space-y-2'>
      <div className='overflow-x-auto'>
        <Table className='min-w-full'>
          <TableHead>
            <TableHeadRow>
              <TableHeadCell>When (UTC)</TableHeadCell>
              <TableHeadCell>Change</TableHeadCell>
              <TableHeadCell>Credits</TableHeadCell>
              <TableHeadCell>Expires</TableHeadCell>
              {admin && <TableHeadCell>By</TableHeadCell>}
              {admin && <TableHeadCell>Reason</TableHeadCell>}
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {changes.map((change, i) => {
              const n = BigInt(change.bytes);
              return (
                <TableBodyRow key={`${change.at}-${change.type}-${i}`}>
                  <TableBodyCell className='whitespace-nowrap'>
                    {dayjs.utc(change.at).format('MMM D, YYYY HH:mm')}
                  </TableBodyCell>
                  <TableBodyCell>
                    {describeFreeCreditChange(change, formatStorageSize)}
                  </TableBodyCell>
                  <TableBodyCell
                    className={`whitespace-nowrap font-medium ${
                      n > ZERO
                        ? 'text-green-700 dark:text-green-400'
                        : n < ZERO
                          ? 'text-red-700 dark:text-red-400'
                          : ''
                    }`}
                  >
                    {signed(change.bytes)}
                  </TableBodyCell>
                  <TableBodyCell>
                    {change.expiresAt ? day(change.expiresAt) : '—'}
                  </TableBodyCell>
                  {admin && (
                    <TableBodyCell className='font-mono text-xs'>
                      {change.by
                        ? formatCid(change.by)
                        : change.type === 'monthly'
                          ? 'Monthly terms'
                          : '—'}
                    </TableBodyCell>
                  )}
                  {admin && (
                    <TableBodyCell>{change.reason ?? '—'}</TableBodyCell>
                  )}
                </TableBodyRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className='text-xs text-gray-500'>
        Newest first. Uploads are counted under Consumed above.
        {changes.some((change) => change.type === 'monthly_change') && (
          <>
            {' '}
            A change to the monthly amount applies at once: what is left of the
            month&apos;s free credits ends, and the new amount less what the
            month has used takes its place. Credits shows the difference.
          </>
        )}
      </p>
    </div>
  );
};

/**
 * An account's usage over whole UTC days: uploads and downloads, split by API
 * key and by customer reference, with the credits purchased and granted for
 * free and the credit balance.
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
  // Free credits are shown only for an account that had any in the range.
  const hasFreeCredits =
    !!report &&
    (BigInt(report.uploads.freeCreditBytes) > BigInt(0) ||
      report.freeCredits.length > 0 ||
      report.freeCreditChanges.length > 0 ||
      Object.values(report.freeCreditBalance ?? {}).some(
        (value) => BigInt(value) > BigInt(0),
      ));

  const hasCustomerReferences =
    !!report &&
    report.customerReferences.some((row) => row.customerReference !== null);

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <UsageDaysPicker days={days} onChange={setDays} />
        <ExportMenu
          exports={EXPORTS.filter(
            ({ table }) =>
              // Tables the report has nothing for are left out once it loads.
              !report ||
              (table !== 'customerReferences' && table !== 'freeCredits') ||
              (table === 'customerReferences' && hasCustomerReferences) ||
              (table === 'freeCredits' && hasFreeCredits),
          )}
          disabled={!range}
          exporting={exporting}
          onExport={download}
        />
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
              hint={
                // Partner accounts have no free tier.
                BigInt(report.uploads.freeTierBytes) > BigInt(0)
                  ? `${bytes(report.uploads.freeTierBytes)} free tier`
                  : undefined
              }
            />
            {hasFreeCredits && (
              <Stat
                label='Paid with free credits'
                value={bytes(report.uploads.freeCreditBytes)}
                hint='Granted at no cost, so no AI3 value'
              />
            )}
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
            <Balance
              balance={report.balance}
              attributionStart={report.attributionStart}
              free={false}
            />
          </Section>

          {hasFreeCredits && (
            <Section title='Free credit balance'>
              <Balance
                balance={report.freeCreditBalance}
                attributionStart={report.attributionStart}
                free
              />
            </Section>
          )}

          {report.freeCreditChanges.length > 0 && (
            <Section title='Free credit history'>
              <FreeCreditHistory changes={report.freeCreditChanges} />
            </Section>
          )}

          <Section title='By API key'>
            <ApiKeysTable rows={report.apiKeys} />
          </Section>

          {hasCustomerReferences && (
            <Section title='Uploads by customer reference'>
              <CustomerReferencesTable rows={report.customerReferences} />
            </Section>
          )}

          <Section title='Credits purchased'>
            <PurchasesTable report={report} />
          </Section>
        </>
      )}
    </div>
  );
};

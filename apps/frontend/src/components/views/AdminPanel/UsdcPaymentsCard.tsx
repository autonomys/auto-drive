'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@auto-drive/ui';
import {
  UsdcClosedReason,
  UsdcManualGateSource,
  type UsdcPaymentsStatus,
} from '@auto-drive/models';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useNetwork } from '../../../contexts/network';
import { formatDate } from '../../../utils/time';

// USDC base units (6 decimals) as a figure a human reads under pressure.
// Truncated rather than rounded, so a displayed balance is never above the one
// actually held.
const formatUsdc = (baseUnits: string | null): string => {
  if (baseUnits === null) return '—';
  const negative = baseUnits.startsWith('-');
  const digits = (negative ? baseUnits.slice(1) : baseUnits).padStart(7, '0');
  const whole = digits.slice(0, -6).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = digits.slice(-6, -4);
  return `${negative ? '-' : ''}${whole}.${cents}`;
};

const formatAge = (ageMs: number | null): string => {
  if (ageMs === null) return 'never';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
};

// Every gate reads the same three ways, so they render the same three ways.
// "Why is the USDC path shut" should be answerable from one glance, which is the
// whole reason all three are shown even when only one is closed.
type GateTone = 'open' | 'closed' | 'unknown';

const TONE = {
  open: {
    Icon: CheckCircle2,
    className: 'text-green-600 dark:text-green-400',
  },
  closed: {
    Icon: XCircle,
    className: 'text-red-600 dark:text-red-400',
  },
  unknown: {
    Icon: AlertTriangle,
    className: 'text-amber-600 dark:text-amber-400',
  },
} as const;

const GateRow = ({
  label,
  tone,
  headline,
  detail,
}: {
  label: string;
  tone: GateTone;
  headline: string;
  detail?: string;
}) => {
  const { Icon, className } = TONE[tone];
  return (
    <div className='flex items-start gap-3 border-t border-border py-3 first:border-t-0'>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
      <div className='min-w-0'>
        <p className='text-xs uppercase tracking-wide text-muted-foreground'>
          {label}
        </p>
        <p className='text-sm font-medium text-foreground'>{headline}</p>
        {detail && (
          <p className='mt-0.5 text-xs text-muted-foreground'>{detail}</p>
        )}
      </div>
    </div>
  );
};

const CLOSED_REASON_LABEL: Record<UsdcClosedReason, string> = {
  [UsdcClosedReason.NOT_CONFIGURED]: 'no Ethereum USDC configuration',
  [UsdcClosedReason.MANUAL_OFF]: 'switched off by an admin',
  [UsdcClosedReason.TREASURY_CAP]: 'treasury cap reached',
  [UsdcClosedReason.BALANCE_UNKNOWN]: 'treasury balance unknown',
};

/**
 * The state of the USDC payment path, and the switch that closes it.
 *
 * Shows all three gates rather than a single red dot: a closed payment path must
 * never be a mystery, and "auto-paused: 2,014.00 USDC held, cap 2,000.00" is a
 * sentence an operator can act on.
 *
 * The manual switch latches — nothing automatic reopens it — so the button says
 * what it will do, not what the state is.
 */
export const UsdcPaymentsCard = () => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();

  const {
    data: status,
    isLoading,
    isFetching,
    error,
  } = useQuery<UsdcPaymentsStatus>({
    queryKey: ['adminUsdcPaymentsStatus'],
    queryFn: () => api.getUsdcPaymentsStatus(),
    // Short: the balance gate moves on its own, and a stale reading of a kill
    // switch is the one thing this card must not show.
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { mutate: setEnabled, isPending } = useMutation<
    unknown,
    Error,
    boolean
  >({
    mutationFn: (enabled: boolean) => api.setUsdcPayments(enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['adminUsdcPaymentsStatus'],
      });
    },
  });

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground'>
        <RefreshCw className='h-4 w-4 animate-spin' />
        Loading USDC payment status…
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className='rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground'>
        Could not read USDC payment status
        {error ? `: ${error.message}` : '.'}
      </div>
    );
  }

  const { availability, configured, manualGate, treasury, oracle } = status;

  return (
    <div className='rounded-lg border border-border bg-card p-4'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <div className='flex items-center gap-2'>
            <h3 className='text-sm font-semibold text-foreground'>
              USDC payments
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                availability.open
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}
            >
              {availability.open
                ? 'accepting'
                : `closed — ${
                    availability.closedReason
                      ? CLOSED_REASON_LABEL[availability.closedReason]
                      : 'unknown reason'
                  }`}
            </span>
            {isFetching && (
              <RefreshCw className='h-3 w-3 animate-spin text-muted-foreground' />
            )}
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            Gates new USDC purchases only. Intents already quoted stay payable,
            and any payment that arrives is still credited.
          </p>
        </div>
        <Button
          variant={manualGate.enabled ? 'destructive' : 'primary'}
          disabled={isPending || !configured}
          onClick={() => setEnabled(!manualGate.enabled)}
        >
          {manualGate.enabled ? 'Disable USDC' : 'Enable USDC'}
        </Button>
      </div>

      <div className='mt-3'>
        <GateRow
          label='Manual switch'
          tone={manualGate.enabled ? 'open' : 'closed'}
          headline={manualGate.enabled ? 'Enabled' : 'Disabled'}
          detail={
            manualGate.source === UsdcManualGateSource.ENV_DEFAULT
              ? 'Never set from here — this is the USDC_PAYMENTS_ENABLED boot ' +
                'default. Flipping it once makes that variable inert.'
              : `Set by ${manualGate.updatedBy ?? 'unknown'}${
                  manualGate.updatedAt
                    ? ` on ${formatDate(manualGate.updatedAt)}`
                    : ''
                }. Only an admin can reopen it.`
          }
        />

        <GateRow
          label='Treasury cap'
          tone={treasury.stale ? 'unknown' : treasury.paused ? 'closed' : 'open'}
          headline={
            treasury.stale
              ? 'Balance unknown — failing closed'
              : treasury.paused
                ? `Auto-paused: ${formatUsdc(
                    treasury.balanceBaseUnits,
                  )} USDC held, cap ${formatUsdc(
                    treasury.pauseThresholdBaseUnits,
                  )}`
                : `${formatUsdc(
                    treasury.balanceBaseUnits,
                  )} USDC held, ${formatUsdc(
                    treasury.headroomBaseUnits,
                  )} of headroom`
          }
          detail={
            treasury.stale
              ? `Last read ${formatAge(treasury.ageMs)}${
                  treasury.checkedAt ? '' : ' — nothing has polled yet'
                }. Checked every ${Math.round(
                  treasury.checkIntervalMs / 60_000,
                )} min; unknown for more than ${Math.round(
                  treasury.maxStaleMs / 60_000,
                )} min refuses new intents. Check the payment worker.`
              : `Read ${formatAge(treasury.ageMs)}. Resumes below ${formatUsdc(
                  treasury.resumeThresholdBaseUnits,
                )}. Watching ${treasury.addresses.length} address${
                  treasury.addresses.length === 1 ? '' : 'es'
                }.`
          }
        />

        <GateRow
          label='Price oracle'
          tone={oracle.healthy ? (oracle.servingStale ? 'unknown' : 'open') : 'closed'}
          headline={
            oracle.healthy
              ? oracle.servingStale
                ? 'Serving the last good rate'
                : 'Quoting'
              : `Refusing to quote — ${oracle.currentFailureReason ?? 'unknown'}`
          }
          detail={
            oracle.window
              ? `${oracle.window.sampleCount} swaps (${oracle.window.buyCount} buy / ` +
                `${oracle.window.sellCount} sell), ` +
                `${formatUsdc(oracle.window.oneSidedVolumeUsdc)} USDC one-sided ` +
                `volume, pool holds ${formatUsdc(oracle.window.poolUsdcDepth)} ` +
                `USDC. Newest fill ${formatDate(oracle.window.newestSwapAt)}.`
              : oracle.lastFailureReason
                ? `Last failure: ${oracle.lastFailureReason}${
                    oracle.lastFailureAt
                      ? ` at ${formatDate(oracle.lastFailureAt)}`
                      : ''
                  }. No successful read yet.`
                : 'No rate read yet.'
          }
        />

        {!configured && (
          <p className='mt-3 text-xs text-muted-foreground'>
            This deployment has no complete Ethereum USDC configuration
            (ETH_CHAIN_ENDPOINT, ETH_USDC_RECEIVER_ADDRESS, USDC_TOKEN_ADDRESS),
            so the switch is inert — nothing would observe a payment.
          </p>
        )}
      </div>
    </div>
  );
};

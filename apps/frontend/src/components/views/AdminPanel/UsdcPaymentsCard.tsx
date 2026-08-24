'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@auto-drive/ui';
import {
  formatUsdcBaseUnits,
  USD_RATE_SCALE,
  UsdcClosedReason,
  UsdcManualGateSource,
  type UsdcPaymentsStatus,
} from '@auto-drive/models';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useNetwork } from '../../../contexts/network';
import { formatDate } from '../../../utils/time';

// One formatter, shared with the backend's alerts through @auto-drive/models:
// two renderings of the same money figure are two things that must agree.
const usdc = (baseUnits: string | null): string =>
  baseUnits === null ? '—' : formatUsdcBaseUnits(baseUnits);

// The oracle's rate is scaled by 1e18. Four decimals, because AI3 trades in
// fractions of a cent and the figure exists to answer "is this sane".
const usdPerAi3 = (scaled: string): string => {
  // BigInt(...) rather than a bigint literal: this app targets below ES2020.
  const tenThousand = BigInt(10000);
  const value = BigInt(scaled);
  const whole = value / USD_RATE_SCALE;
  const fraction = ((value % USD_RATE_SCALE) * tenThousand) / USD_RATE_SCALE;
  return `$${whole}.${fraction.toString().padStart(4, '0')}`;
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
// "Why is the USDC path shut" should be answerable at a glance, which is the
// whole reason all of them are shown even when only one is closed.
type GateTone = 'open' | 'closed' | 'unknown';

const TONE = {
  open: { Icon: CheckCircle2, className: 'text-green-600 dark:text-green-400' },
  closed: { Icon: XCircle, className: 'text-red-600 dark:text-red-400' },
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
  [UsdcClosedReason.ORACLE_UNAVAILABLE]: 'no AI3/USD rate',
};

/**
 * The state of the USDC payment path, and the switch that closes it.
 *
 * Shows every gate rather than a single red dot: a closed payment path must never
 * be a mystery, and "auto-paused: 2,014.00 USDC held, cap 2,000.00" is a sentence
 * an operator can act on.
 *
 * Enabling asks for confirmation and disabling does not — one click reopens the
 * money path, and the asymmetry is deliberate: an incident control must never be
 * slower than the incident.
 */
export const UsdcPaymentsCard = () => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();
  const [confirmingEnable, setConfirmingEnable] = useState(false);

  const {
    data: status,
    isLoading,
    isFetching,
    error,
  } = useQuery<UsdcPaymentsStatus>({
    queryKey: ['adminUsdcPaymentsStatus'],
    queryFn: () => api.getUsdcPaymentsStatus(),
    // Aligned with the backend's own rate cache (ORACLE_CACHE_TTL_MS, 60s):
    // polling faster only re-renders the same answer.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const {
    mutate: setEnabled,
    isPending,
    error: mutationError,
    reset: resetMutation,
  } = useMutation<unknown, Error, boolean>({
    mutationFn: (enabled: boolean) => api.setUsdcPayments(enabled),
    onSuccess: () => {
      setConfirmingEnable(false);
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

  const onToggle = () => {
    resetMutation();
    if (manualGate.enabled) {
      setEnabled(false);
      return;
    }
    if (!confirmingEnable) {
      setConfirmingEnable(true);
      return;
    }
    setEnabled(true);
  };

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
                : `closed — ${CLOSED_REASON_LABEL[availability.closedReason]}`}
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
        <div className='flex flex-col items-end gap-1'>
          <Button
            variant={manualGate.enabled ? 'destructive' : 'primary'}
            disabled={isPending || !configured}
            onClick={onToggle}
          >
            {isPending
              ? 'Saving…'
              : manualGate.enabled
                ? 'Disable USDC'
                : confirmingEnable
                  ? 'Confirm enable'
                  : 'Enable USDC'}
          </Button>
          {confirmingEnable && !manualGate.enabled && !isPending && (
            <button
              className='text-xs text-muted-foreground underline'
              onClick={() => setConfirmingEnable(false)}
            >
              cancel
            </button>
          )}
          {/* A kill switch that fails quietly is worse than no kill switch: the
              admin walks away believing the path is shut. */}
          {mutationError && (
            <p className='max-w-[16rem] text-right text-xs text-red-600 dark:text-red-400'>
              Change failed — the gate is unchanged. {mutationError.message}
            </p>
          )}
        </div>
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
          tone={
            treasury.thresholdError || treasury.addressError || treasury.stale
              ? 'unknown'
              : treasury.paused
                ? 'closed'
                : 'open'
          }
          headline={
            treasury.thresholdError
              ? 'Cap configuration unusable — failing closed'
              : treasury.addressError
                ? 'Address configuration unusable — failing closed'
                : treasury.stale
                  ? 'Balance unknown — failing closed'
                  : treasury.paused
                    ? `Auto-paused: ${usdc(
                        treasury.balanceBaseUnits,
                      )} USDC held, cap ${usdc(
                        treasury.pauseThresholdBaseUnits,
                      )}`
                    : `${usdc(treasury.balanceBaseUnits)} USDC held, ${usdc(
                        treasury.headroomBaseUnits,
                      )} of headroom`
          }
          detail={
            // The configuration errors come first: both stop the poller, so the
            // balance below them would be stale for a reason the operator cannot
            // guess from "unknown".
            treasury.thresholdError ||
            treasury.addressError ||
            (treasury.stale
              ? `Last read ${formatAge(treasury.ageMs)}${
                  treasury.checkedAt ? '' : ' — nothing has polled yet'
                }. Refreshed every ${Math.round(
                  treasury.checkIntervalMs / 60_000,
                )} min; unknown for more than ${Math.round(
                  treasury.maxStaleMs / 60_000,
                )} min refuses new intents. Check the payment worker.`
              : `Read ${formatAge(treasury.ageMs)}. Resumes below ${usdc(
                  treasury.resumeThresholdBaseUnits,
                )}. Watching ${treasury.addresses.length} address${
                  treasury.addresses.length === 1 ? '' : 'es'
                }.`)
          }
        />

        <GateRow
          label='Price oracle'
          tone={oracle.stale ? 'unknown' : oracle.healthy ? 'open' : 'closed'}
          headline={
            oracle.stale
              ? 'Rate unknown — failing closed'
              : oracle.healthy
                ? `Quoting at ${
                    oracle.usdPerAi3 ? usdPerAi3(oracle.usdPerAi3) : '—'
                  } per AI3${oracle.servingStale ? ' (last good rate)' : ''}`
                : `Refusing to quote — ${oracle.reason ?? 'unknown'}`
          }
          detail={
            oracle.window
              ? `${oracle.window.sampleCount} swaps (${oracle.window.buyCount} buy / ` +
                `${oracle.window.sellCount} sell), ` +
                `${usdc(oracle.window.oneSidedVolumeUsdc)} USDC one-sided volume, ` +
                `pool holds ${usdc(oracle.window.poolUsdcDepth)} USDC. Newest ` +
                `fill ${formatDate(
                  oracle.window.newestSwapAt,
                )}. Read ${formatAge(oracle.ageMs)}.`
              : oracle.stale
                ? 'The rate is only re-read while the manual switch is on, so ' +
                  'this stays unknown for up to one refresh after enabling.'
                : `Read ${formatAge(oracle.ageMs)}. No usable swap window.`
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

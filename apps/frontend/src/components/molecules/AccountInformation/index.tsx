import { utcToLocalRelativeTime } from '../../../utils/time';
import { AccountModel } from '@auto-drive/models';
import { formatBytes } from '../../../utils/number';
import Link from 'next/link';

interface CreditLimitsProps {
  uploadPending: number;
  uploadLimit: number;
  renewalDate: Date;
  model: AccountModel;
  /**
   * Bytes remaining across all active purchased-credit rows.
   * Only passed (non-zero) when the buyCredits feature flag is active.
   */
  purchasedBytesRemaining?: number;
  /**
   * Total originally-purchased bytes (sum of upload_bytes_original across
   * active rows). Used to render a "X used out of Y" progress bar.
   * Only meaningful when purchasedBytesRemaining > 0.
   */
  purchasedBytesTotal?: number;
  /**
   * Soonest expiry date across the user's active purchased-credit rows.
   */
  nextExpiryDate?: Date | null;
  /**
   * href to the credit purchase history page.
   * When provided a "View purchase history" link is shown.
   */
  creditHistoryHref?: string;
}

export const AccountInformation = ({
  model,
  uploadPending = 0,
  uploadLimit = 1000,
  renewalDate,
  purchasedBytesRemaining = 0,
  purchasedBytesTotal = 0,
  nextExpiryDate = null,
  creditHistoryHref,
}: CreditLimitsProps) => {
  const hasPurchasedCredits = purchasedBytesRemaining > 0;

  // ── Free-quota calculations ──────────────────────────────────────────────
  // uploadPending is free-remaining only (purchased bytes stripped by caller).
  const freeUsed = uploadLimit - uploadPending;
  const freePercentage = Math.max(
    0,
    Math.min(100, (freeUsed / uploadLimit) * 100),
  );

  // ── Purchased-credits calculations ───────────────────────────────────────
  const purchasedUsed = Math.max(
    0,
    purchasedBytesTotal - purchasedBytesRemaining,
  );
  const purchasedPercentage =
    purchasedBytesTotal > 0
      ? Math.max(
          0,
          Math.min(100, (purchasedUsed / purchasedBytesTotal) * 100),
        )
      : 0;

  return (
    <div className='space-y-4'>

      {/* ── Free storage section ──────────────────────────────────────────── */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <span className='text-xs font-medium'>Free storage</span>
          <span className='text-xs text-muted-foreground'>
            {formatBytes(Math.max(0, uploadPending), 2)} left
          </span>
        </div>
        <div className='h-1.5 w-full rounded-full bg-muted'>
          <div
            className='h-1.5 rounded-full bg-primary transition-all'
            style={{ width: `${freePercentage}%` }}
          />
        </div>
        <div className='text-xs text-muted-foreground'>
          {formatBytes(Math.max(0, freeUsed), 2)} used of{' '}
          {formatBytes(uploadLimit, 2)} free quota
        </div>
        {model === AccountModel.Monthly && (
          <div className='text-xs text-muted-foreground'>
            Renews in {utcToLocalRelativeTime(renewalDate.toISOString())}
          </div>
        )}
      </div>

      {/* ── Purchased credits section (feature-flag gated) ────────────────── */}
      {hasPurchasedCredits && (
        <div className='space-y-2 border-t border-border pt-4'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-medium'>Purchased credits</span>
            <span className='text-xs font-medium'>
              {formatBytes(purchasedBytesRemaining, 2)} left
            </span>
          </div>

          {/* Progress bar + usage breakdown — only shown when the backend
              provides the total (field added in this PR; older backends omit it). */}
          {purchasedBytesTotal > 0 && (
            <>
              <div className='h-1.5 w-full rounded-full bg-muted'>
                <div
                  className='h-1.5 rounded-full bg-green-500 transition-all'
                  style={{ width: `${purchasedPercentage}%` }}
                />
              </div>
              <div className='text-xs text-muted-foreground'>
                {formatBytes(purchasedUsed, 2)} used of{' '}
                {formatBytes(purchasedBytesTotal, 2)} purchased
              </div>
            </>
          )}

          {nextExpiryDate && (
            <div className='text-xs text-amber-600 dark:text-amber-400'>
              Expires {utcToLocalRelativeTime(nextExpiryDate.toISOString())}
            </div>
          )}
        </div>
      )}

      {/* ── View purchase history link ─────────────────────────────────────── */}
      {creditHistoryHref && (
        <div className={hasPurchasedCredits ? '' : 'border-t border-border pt-3'}>
          <Link
            href={creditHistoryHref}
            className='text-xs text-primary hover:underline'
          >
            View purchase history →
          </Link>
        </div>
      )}
    </div>
  );
};

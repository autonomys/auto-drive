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
   * Only passed when the buyCredits feature flag is active for this user.
   * Defaults to 0 (no purchased credits section rendered).
   */
  purchasedBytesRemaining?: number;
  /**
   * Soonest expiry date across the user's active purchased-credit rows.
   * Shown as a hint when the purchased-credits section is rendered.
   */
  nextExpiryDate?: Date | null;
  /**
   * href to the credit history page. When provided, a "View history" link is
   * shown below the purchased credits row. Only passed when the buyCredits
   * feature flag is active.
   */
  creditHistoryHref?: string;
}

export const AccountInformation = ({
  model,
  uploadPending = 0,
  uploadLimit = 1000,
  renewalDate,
  purchasedBytesRemaining = 0,
  nextExpiryDate = null,
  creditHistoryHref,
}: CreditLimitsProps) => {
  // uploadPending is free-remaining only (purchased bytes stripped out by the
  // caller).  uploadUsed may be negative when the free quota is fully
  // exhausted and the user is uploading against purchased credits.
  const uploadUsed = uploadLimit - uploadPending;

  // Progress bar: clamp to [0, 100]. A negative uploadUsed (free quota
  // over-extended by purchased credits) renders as 100%, which is correct —
  // the free allocation is fully consumed.
  const uploadPercentage = Math.max(
    0,
    Math.min(100, (uploadUsed / uploadLimit) * 100),
  );

  const hasPurchasedCredits = purchasedBytesRemaining > 0;

  // When the user has purchased credits, show total available (free + purchased)
  // as the primary "left" figure.  This is the number that governs whether an
  // upload will succeed.  When purchased credits are not in play, show only the
  // free remaining so the label and progress bar tell the same story.
  const totalAvailable = uploadPending + purchasedBytesRemaining;
  const displayAvailable = hasPurchasedCredits ? totalAvailable : uploadPending;

  return (
    <div className='space-y-2'>
      <div className='text-xs text-muted-foreground'>Upload usage</div>
      <div className='space-y-1'>
        <div className='flex justify-between text-xs'>
          <span>{formatBytes(displayAvailable, 2)} left</span>
          <span className='text-muted-foreground'>
            {formatBytes(Math.max(0, uploadUsed), 2)}/{formatBytes(uploadLimit, 2)}
          </span>
        </div>
        <div className='h-1.5 w-full rounded-full bg-muted'>
          <div
            className='h-1.5 rounded-full bg-primary'
            style={{ width: `${uploadPercentage}%` }}
          ></div>
        </div>
      </div>
      {model === AccountModel.Monthly && (
        <p className='space-y-2 text-xs text-muted-foreground'>
          Renews in {utcToLocalRelativeTime(renewalDate.toISOString())}
        </p>
      )}

      {/* Purchased credits — rendered when the user has remaining balance. */}
      {hasPurchasedCredits && (
        <div className='border-t border-border pt-2'>
          <div className='text-xs text-muted-foreground'>Purchased credits</div>
          <div className='mt-1 flex items-center justify-between text-xs'>
            <span className='font-medium'>
              {formatBytes(purchasedBytesRemaining, 2)}
            </span>
            {nextExpiryDate && (
              <span className='text-muted-foreground'>
                expires {utcToLocalRelativeTime(nextExpiryDate.toISOString())}
              </span>
            )}
          </div>
        </div>
      )}
      {creditHistoryHref && (
        <div className={hasPurchasedCredits ? '' : 'border-t border-border pt-2'}>
          <Link
            href={creditHistoryHref}
            className='mt-1 block text-xs text-primary hover:underline'
          >
            View history →
          </Link>
        </div>
      )}
    </div>
  );
};

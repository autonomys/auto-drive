import { utcToLocalRelativeTime } from '../../../utils/time';
import { AccountModel } from '@auto-drive/models';
import { formatBytes } from '../../../utils/number';

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
}

export const AccountInformation = ({
  model,
  uploadPending = 0,
  uploadLimit = 1000,
  renewalDate,
  purchasedBytesRemaining = 0,
  nextExpiryDate = null,
}: CreditLimitsProps) => {
  const uploadUsed = uploadLimit - uploadPending;

  const uploadPercentage = Math.max(
    0,
    Math.min(100, (uploadUsed / uploadLimit) * 100),
  );

  const hasPurchasedCredits = purchasedBytesRemaining > 0;

  return (
    <div className='space-y-2'>
      <div className='text-xs text-muted-foreground'>Upload usage</div>
      <div className='space-y-1'>
        <div className='flex justify-between text-xs'>
          <span>{formatBytes(uploadPending, 2)} left</span>
          <span className='text-muted-foreground'>
            {formatBytes(uploadUsed, 2)}/{formatBytes(uploadLimit, 2)}
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

      {/* Purchased credits — only rendered when the user has active purchased
          credits (i.e. hasBuyCreditsFeature AND uploadBytesRemaining > 0).
          Invisible to all other account types and feature-flag states. */}
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
    </div>
  );
};

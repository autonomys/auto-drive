import { truncateBytes } from '../../../utils/number';
import { utcToLocalRelativeTime } from '../../../utils/time';
import { SubscriptionGranularity } from '@auto-drive/models';

interface CreditLimitsProps {
  uploadPending: number;
  uploadLimit: number;
  renewalDate: Date;
  granularity: SubscriptionGranularity;
}

export const AccountInformation = ({
  granularity,
  uploadPending = 0,
  uploadLimit = 1000,
  renewalDate,
}: CreditLimitsProps) => {
  const uploadUsed = uploadLimit - uploadPending;

  const uploadPercentage = (uploadUsed / uploadLimit) * 100;

  return (
    <div className='space-y-2'>
      <div className='text-xs text-muted-foreground'>Upload usage</div>
      <div className='space-y-1'>
        <div className='flex justify-between text-xs'>
          <span>{truncateBytes(uploadPending)} left</span>
          <span className='text-muted-foreground'>
            {truncateBytes(uploadUsed)}/{truncateBytes(uploadLimit)}
          </span>
        </div>
        <div className='h-1.5 w-full rounded-full bg-muted'>
          <div
            className='h-1.5 rounded-full bg-primary'
            style={{ width: `${uploadPercentage}%` }}
          ></div>
        </div>
      </div>
      {granularity === SubscriptionGranularity.Monthly && (
        <p className='space-y-2 text-xs text-muted-foreground'>
          Renews in {utcToLocalRelativeTime(renewalDate.toISOString())}
        </p>
      )}
    </div>
  );
};

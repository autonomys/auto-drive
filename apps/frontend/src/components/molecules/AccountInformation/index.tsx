import bytes from 'bytes';
import { utcToLocalRelativeTime } from '../../../utils/time';
import { AccountModel } from '@auto-drive/models';

interface CreditLimitsProps {
  uploadPending: number;
  uploadLimit: number;
  renewalDate: Date;
  model: AccountModel;
}

export const AccountInformation = ({
  model,
  uploadPending = 0,
  uploadLimit = 1000,
  renewalDate,
}: CreditLimitsProps) => {
  const uploadUsed = uploadLimit - uploadPending;

  const uploadPercentage = Math.max(
    0,
    Math.min(100, (uploadUsed / uploadLimit) * 100),
  );

  return (
    <div className='space-y-2'>
      <div className='text-xs text-muted-foreground'>Upload usage</div>
      <div className='space-y-1'>
        <div className='flex justify-between text-xs'>
          <span>{bytes(uploadPending, { decimalPlaces: 2 })} left</span>
          <span className='text-muted-foreground'>
            {bytes(uploadLimit, { decimalPlaces: 2 })}/
            {bytes(uploadLimit, { decimalPlaces: 2 })}
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
    </div>
  );
};

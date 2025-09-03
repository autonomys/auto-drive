import bytes from 'bytes';
import { utcToLocalRelativeTime } from '../../../utils/time';

interface CreditLimitsProps {
  uploadPending: number;
  uploadLimit: number;
  renewalDate: Date;
}

export const AccountInformation = ({
  uploadPending = 0,
  uploadLimit = 1000,
  renewalDate,
}: CreditLimitsProps) => {
  const uploadUsed = uploadLimit - uploadPending;

  const uploadPercentage = (uploadUsed / uploadLimit) * 100;

  return (
    <div className='space-y-2'>
      <div className='text-muted-foreground text-xs'>Upload usage</div>
      <div className='space-y-1'>
        <div className='flex justify-between text-xs'>
          <span>{bytes(uploadPending)} left</span>
          <span className='text-muted-foreground'>
            {bytes(uploadUsed)}/{bytes(uploadLimit)}
          </span>
        </div>
        <div className='bg-muted h-1.5 w-full rounded-full'>
          <div
            className='h-1.5 rounded-full bg-primary'
            style={{ width: `${uploadPercentage}%` }}
          ></div>
        </div>
      </div>
      <p className='text-muted-foreground space-y-2 text-xs'>
        Renews in {utcToLocalRelativeTime(renewalDate.toISOString())}
      </p>
    </div>
  );
};

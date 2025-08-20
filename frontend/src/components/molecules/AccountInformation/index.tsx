import bytes from 'bytes';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/atoms/Button';
import { utcToLocalRelativeTime } from '../../../utils/time';
import { EXTERNAL_ROUTES } from '../../../constants/routes';

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
      <a
        target='_blank'
        rel='noreferrer'
        href={EXTERNAL_ROUTES.requestMoreCreditsForm}
        className='contents'
      >
        <Button variant='outline' size='sm' className='w-full text-xs'>
          Ask for more credits
        </Button>
      </a>
    </div>
  );
};

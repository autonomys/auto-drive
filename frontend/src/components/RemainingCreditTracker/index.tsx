import bytes from 'bytes';
import { Download, Upload } from 'lucide-react';
import { Button } from '../common/Button';

interface CreditLimitsProps {
  uploadPending: number;
  uploadLimit: number;
  downloadPending: number;
  downloadLimit: number;
  startDate: string;
  endDate: string;
}

export const RemainingCreditTracker = ({
  uploadPending = 0,
  uploadLimit = 1000,
  downloadPending = 0,
  downloadLimit = 2000,
  startDate,
  endDate,
}: CreditLimitsProps) => {
  const uploadUsed = uploadLimit - uploadPending;
  const downloadUsed = downloadLimit - downloadPending;

  const uploadPercentage = (uploadUsed / uploadLimit) * 100;
  const downloadPercentage = (downloadUsed / downloadLimit) * 100;

  return (
    <div className='dark:bg-darkWhite dark:text-darkBlack mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-white'>
      <div className='py-4'>
        <div className='space-y-6'>
          <div>
            <div className='dark:text-darkBlack mb-1 flex justify-between text-sm text-gray-600'>
              <span>
                <span>{bytes(Number(uploadUsed))}</span>/
                <span>{bytes(Number(uploadLimit))}</span>
              </span>
              <span className='text-secondary px-2'>
                <Upload className='h-4 w-4' />
              </span>
            </div>
            <div className='h-2.5 w-full rounded-full bg-gray-200'>
              <div
                className='dark:bg-darkPrimary h-2.5 w-32 rounded-full bg-primary'
                style={{ width: `${uploadPercentage}%` }}
                role='progressbar'
                aria-valuenow={uploadUsed}
                aria-valuemin={0}
                aria-valuemax={uploadLimit}
              ></div>
            </div>
          </div>

          <div>
            <div className='dark:text-darkBlack mb-1 flex justify-between text-sm text-gray-600 text-primary'>
              <span>
                <span>{bytes(downloadUsed)}</span>/
                <span className='dark:text-darkBlack text-gray-500'>
                  {bytes(downloadLimit)}
                </span>
              </span>
              <span className='text-secondary px-2'>
                <Download className='h-4 w-4' />
              </span>
            </div>
            <div className='h-2.5 w-8 w-full rounded-full bg-gray-200'>
              <div
                className='dark:bg-darkPrimary h-2.5 w-full rounded-full bg-primary'
                style={{ width: `${downloadPercentage}%` }}
                role='progressbar'
                aria-valuenow={downloadUsed}
                aria-valuemin={0}
                aria-valuemax={downloadLimit}
              ></div>
            </div>
          </div>
        </div>
        <div className='mt-2 flex flex-col text-center'>
          <span className='dark:text-darkBlack text-sm text-gray-400'>
            Credit for period
          </span>
          <div className='dark:text-darkBlack text-center text-sm text-gray-600'>
            {startDate} - {endDate}
          </div>
        </div>
        <div className='mt-2 flex flex-col text-center'>
          <a
            target='_blank'
            rel='noreferrer'
            href='https://forms.gle/EAPzicXcbP7gH2uT6'
            className='text-sm text-black hover:underline'
          >
            <Button variant='primary'>Ask for more credits</Button>
          </a>
        </div>
      </div>
    </div>
  );
};

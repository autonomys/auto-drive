'use client';

import { Loader } from 'lucide-react';
import { useUserStore } from 'globalStates/user';
import { UsageReportView } from '.';

/** The signed-in user's own account, for the Usage page. */
export const AccountUsage = () => {
  const account = useUserStore((state) => state.account);

  return (
    <div className='flex flex-col gap-4 p-2'>
      <div>
        <h1 className='text-2xl font-bold'>Usage</h1>
        <p className='mt-1 text-sm text-gray-500'>
          Uploads, downloads and credits for your organization&apos;s account,
          by API key.
        </p>
      </div>
      {account ? (
        <UsageReportView accountId={account.id} />
      ) : (
        <div className='flex items-center justify-center py-8'>
          <Loader className='h-6 w-6 animate-spin' />
        </div>
      )}
    </div>
  );
};

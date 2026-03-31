'use client';

import { useCallback, useEffect, useState } from 'react';
import { AuthService } from 'services/auth/auth';
import { useUserStore } from 'globalStates/user';
import { useDeletionStore } from 'globalStates/deletion';
import toast from 'react-hot-toast';

export const DeletionWarningBanner = () => {
  const [isCancelling, setIsCancelling] = useState(false);
  const user = useUserStore((state) => state.user);
  const deletionRequest = useDeletionStore((state) => state.deletionRequest);
  const setDeletionRequest = useDeletionStore(
    (state) => state.setDeletionRequest,
  );

  const fetchStatus = useCallback(async () => {
    try {
      const status = await AuthService.getDeletionStatus();
      setDeletionRequest(status);
    } catch {
      // User may not be authenticated yet
    }
  }, [setDeletionRequest]);

  useEffect(() => {
    if (user) {
      fetchStatus();
    }
  }, [user, fetchStatus]);

  const handleCancel = useCallback(async () => {
    setIsCancelling(true);
    try {
      await AuthService.cancelDeletion();
      toast.success('Account deletion cancelled');
      setDeletionRequest(null);
    } catch {
      toast.error('Failed to cancel deletion');
    } finally {
      setIsCancelling(false);
    }
  }, [setDeletionRequest]);

  if (!deletionRequest) return null;

  const scheduledDate = new Date(
    deletionRequest.scheduledAnonymisationAt,
  ).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className='flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700 dark:bg-red-900/20'>
      <div className='text-sm'>
        <span className='font-medium text-red-700 dark:text-red-300'>
          Account deletion scheduled.
        </span>{' '}
        <span className='text-red-600 dark:text-red-400'>
          Your data will be anonymised on{' '}
          <span className='font-semibold'>{scheduledDate}</span>.
        </span>
      </div>
      <button
        type='button'
        onClick={handleCancel}
        disabled={isCancelling}
        className='ml-4 shrink-0 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-600 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50'
      >
        {isCancelling ? 'Cancelling...' : 'Cancel Deletion'}
      </button>
    </div>
  );
};

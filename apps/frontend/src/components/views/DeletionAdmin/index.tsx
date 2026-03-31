'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DeletionRequestStatus,
  DeletionRequestWithUser,
} from '@auto-drive/models';
import { Button } from '@auto-drive/ui';
import toast from 'react-hot-toast';
import { AuthService } from 'services/auth/auth';

const STATUS_LABELS: Record<DeletionRequestStatus, string> = {
  [DeletionRequestStatus.Pending]: 'Pending',
  [DeletionRequestStatus.Processing]: 'Processing',
  [DeletionRequestStatus.Completed]: 'Completed',
  [DeletionRequestStatus.Failed]: 'Failed',
  [DeletionRequestStatus.Cancelled]: 'Cancelled',
};

const STATUS_COLORS: Record<DeletionRequestStatus, string> = {
  [DeletionRequestStatus.Pending]:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  [DeletionRequestStatus.Processing]:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  [DeletionRequestStatus.Completed]:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  [DeletionRequestStatus.Failed]:
    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  [DeletionRequestStatus.Cancelled]:
    'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

export const DeletionAdmin = () => {
  const [requests, setRequests] = useState<DeletionRequestWithUser[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await AuthService.getAdminDeletionRequests(
        statusFilter || undefined,
      );
      setRequests(data);
    } catch (error) {
      toast.error('Failed to load deletion requests');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleSaveNotes = useCallback(
    async (requestId: string) => {
      try {
        await AuthService.updateDeletionAdminNotes(requestId, notesText);
        toast.success('Notes updated');
        setEditingNotes(null);
        fetchRequests();
      } catch (error) {
        toast.error('Failed to update notes');
        console.error(error);
      }
    },
    [notesText, fetchRequests],
  );

  const formatDate = (date: string | Date) =>
    new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className='flex flex-col gap-6 p-2'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>Account Deletions</h1>
        <div className='flex items-center gap-2'>
          <label
            htmlFor='deletion-status-filter'
            className='text-sm text-gray-600 dark:text-gray-400'
          >
            Filter:
          </label>
          <select
            id='deletion-status-filter'
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className='rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white'
          >
            <option value=''>All</option>
            {Object.values(DeletionRequestStatus).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <Button variant='lightAccent' onClick={fetchRequests}>
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className='py-8 text-center text-gray-500'>Loading...</div>
      ) : requests.length === 0 ? (
        <div className='py-8 text-center text-gray-500'>
          No deletion requests found
        </div>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-left text-sm'>
            <thead className='border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700'>
              <tr>
                <th className='px-4 py-3'>User</th>
                <th className='px-4 py-3'>Status</th>
                <th className='px-4 py-3'>Requested</th>
                <th className='px-4 py-3'>Scheduled</th>
                <th className='px-4 py-3'>Reason</th>
                <th className='px-4 py-3'>Admin Notes</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-100 dark:divide-gray-700'>
              {requests.map((req) => (
                <tr
                  key={req.id}
                  className='hover:bg-gray-50 dark:hover:bg-gray-800'
                >
                  <td className='px-4 py-3'>
                    <div className='font-mono text-xs'>
                      {req.userPublicId.slice(0, 8)}...
                    </div>
                    {req.oauthUsername && (
                      <div className='text-xs text-gray-500'>
                        {req.oauthUsername}
                      </div>
                    )}
                  </td>
                  <td className='px-4 py-3'>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[req.status as DeletionRequestStatus]
                      }`}
                    >
                      {STATUS_LABELS[req.status as DeletionRequestStatus] ??
                        req.status}
                    </span>
                  </td>
                  <td className='px-4 py-3 text-xs'>
                    {formatDate(req.requestedAt)}
                  </td>
                  <td className='px-4 py-3 text-xs'>
                    {formatDate(req.scheduledAnonymisationAt)}
                  </td>
                  <td className='max-w-[200px] truncate px-4 py-3 text-xs'>
                    {req.reason ?? '-'}
                  </td>
                  <td className='px-4 py-3'>
                    {editingNotes === req.id ? (
                      <div className='flex gap-1'>
                        <input
                          type='text'
                          value={notesText}
                          onChange={(e) => setNotesText(e.target.value)}
                          className='w-40 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700'
                        />
                        <Button
                          variant='lightAccent'
                          className='px-2 py-1 text-xs'
                          onClick={() => handleSaveNotes(req.id)}
                        >
                          Save
                        </Button>
                        <Button
                          variant='lightAccent'
                          className='px-2 py-1 text-xs'
                          onClick={() => setEditingNotes(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        type='button'
                        className='cursor-pointer text-xs hover:underline'
                        onClick={() => {
                          setEditingNotes(req.id);
                          setNotesText(req.adminNotes ?? '');
                        }}
                      >
                        {req.adminNotes ?? 'Add notes...'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

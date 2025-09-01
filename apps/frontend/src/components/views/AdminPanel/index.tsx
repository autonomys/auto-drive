'use client';

import { AuthService } from 'services/auth/auth';
import { UserSubscriptionsTable } from '../../organisms/UserTable';
import { useCallback, useEffect, useState } from 'react';
import {
  OnboardedUser,
  PaginatedResult,
  SubscriptionInfoWithUser,
} from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { Button } from '../../atoms/Button';

export const AdminPanel = () => {
  const [subscriptionsWithUsers, setSubscriptionsWithUsers] = useState<
    SubscriptionInfoWithUser[]
  >([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [searchPublicId, setSearchPublicId] = useState('');
  const [searchError, setSearchError] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const network = useNetwork();

  const fetchUserList = useCallback(async () => {
    try {
      const result: PaginatedResult<OnboardedUser> =
        await AuthService.getUserList(currentPage, itemsPerPage);

      if (result.rows.length > 0) {
        setTotalCount(result.totalCount);

        // Get all public IDs from users to fetch their subscriptions
        const publicIds = result.rows.map((user) => user.publicId);

        const subscriptionsByPublicId =
          await network?.api.getUserList(publicIds);
        if (subscriptionsByPublicId) {
          const subscriptions = Object.entries(subscriptionsByPublicId);
          const subscriptionsWithUsers: SubscriptionInfoWithUser[] =
            subscriptions.map(([publicId, subscription]) => ({
              ...subscription,
              pendingUploadCredits: subscription.pendingUploadCredits || 0,
              pendingDownloadCredits: subscription.pendingDownloadCredits || 0,
              user: result.rows.find((user) => user.publicId === publicId)!,
            }));

          setSubscriptionsWithUsers(subscriptionsWithUsers);
        }
      } else {
        setSubscriptionsWithUsers([]);
      }
    } catch (error) {
      console.error('Error fetching user list:', error);
    }
  }, [network?.api, currentPage, itemsPerPage]);

  useEffect(() => {
    fetchUserList();
  }, [fetchUserList]);

  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!searchPublicId.trim()) {
      setSearchError('Please enter a public ID');
      return;
    }

    setIsSearching(true);
    setSearchError('');

    try {
      const user = await AuthService.getUserByPublicId(searchPublicId);

      if (user) {
        const publicIds = [user.publicId];
        const subscriptionsByPublicId =
          await network?.api.getUserList(publicIds);

        if (subscriptionsByPublicId) {
          const subscriptions = Object.values(subscriptionsByPublicId);
          const subscriptionsWithUsers: SubscriptionInfoWithUser[] =
            subscriptions.map((subscription) => ({
              ...subscription,
              pendingUploadCredits: subscription.pendingUploadCredits || 0,
              pendingDownloadCredits: subscription.pendingDownloadCredits || 0,
              user: user,
            }));

          setSubscriptionsWithUsers(subscriptionsWithUsers);
          setTotalCount(1);
        } else {
          // If no subscription data, still show the user
          setSubscriptionsWithUsers([]);
          setTotalCount(0);
        }
      }
    } catch (error) {
      console.error('Error searching for user:', error);
      setSearchError('User not found');
      setSubscriptionsWithUsers([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleResetSearch = () => {
    setSearchPublicId('');
    setSearchError('');
    fetchUserList();
  };

  // Calculate total pages based on the total count from server
  const totalPages = Math.ceil(totalCount / itemsPerPage);

  // Pagination handlers
  const handlePageChange = (pageNumber: number) => {
    setCurrentPage(pageNumber);
  };

  const handleItemsPerPageChange = (items: number) => {
    setItemsPerPage(items);
    setCurrentPage(1); // Reset to first page when changing items per page
  };

  return (
    <div>
      <h1 className='mb-4 text-2xl font-bold'>Users</h1>

      <div className='mb-6'>
        <form onSubmit={handleSearchUser} className='flex items-end gap-2'>
          <div className='flex flex-col'>
            <label htmlFor='publicId' className='mb-1 text-sm'>
              Search by Public ID
            </label>
            <input
              id='publicId'
              type='text'
              value={searchPublicId}
              onChange={(e) => setSearchPublicId(e.target.value)}
              placeholder='Enter exact public ID'
              className='rounded border px-3 py-2'
            />
          </div>
          <Button
            variant='primary'
            disabled={isSearching}
            className='rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50'
          >
            {isSearching ? 'Searching...' : 'Search'}
          </Button>
          {searchPublicId && (
            <Button
              variant='lightDanger'
              onClick={handleResetSearch}
              className='rounded bg-gray-300 px-4 py-2 text-gray-800 hover:bg-gray-400'
            >
              Reset
            </Button>
          )}
        </form>
        {searchError && <p className='mt-2 text-red-500'>{searchError}</p>}
      </div>

      <div className='flex flex-col gap-2'>
        <UserSubscriptionsTable
          users={subscriptionsWithUsers}
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
        />
      </div>
    </div>
  );
};

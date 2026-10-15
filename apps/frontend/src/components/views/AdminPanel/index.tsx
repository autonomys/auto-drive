'use client';

import { AuthService } from 'services/auth/auth';
import { UserAccountsTable } from '../../organisms/UserTable';
import { useCallback, useEffect, useState } from 'react';
import {
  OnboardedUser,
  PaginatedResult,
  AccountInfoWithUser,
} from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { Button, ROUTES } from '@auto-drive/ui';
import { AdminStats } from './AdminStats';
import Link from 'next/link';
import { CreditCard, ChevronRight, Flag } from 'lucide-react';

export const AdminPanel = () => {
  const [accountsWithUsers, setAccountsWithUsers] = useState<
    AccountInfoWithUser[]
  >([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  // Non-null while search results are shown. They are paginated locally, so
  // the server-paginated user list must not refetch over them.
  const [searchResults, setSearchResults] = useState<
    AccountInfoWithUser[] | null
  >(null);

  const network = useNetwork();

  const fetchUserList = useCallback(async () => {
    try {
      const result: PaginatedResult<OnboardedUser> =
        await AuthService.getUserList(currentPage, itemsPerPage);

      if (result.rows.length > 0) {
        setTotalCount(result.totalCount);

        // Get all public IDs from users to fetch their accounts
        const publicIds = result.rows.map((user) => user.publicId);

        const accountsByPublicId = await network?.api.getUserList(publicIds);
        if (accountsByPublicId) {
          const accounts = Object.entries(accountsByPublicId);
          const accountsWithUsers: AccountInfoWithUser[] = accounts.map(
            ([publicId, account]) => ({
              ...account,
              pendingUploadCredits: account.pendingUploadCredits || 0,
              pendingDownloadCredits: account.pendingDownloadCredits || 0,
              user: result.rows.find((user) => user.publicId === publicId)!,
            }),
          );

          setAccountsWithUsers(accountsWithUsers);
        }
      } else {
        setAccountsWithUsers([]);
      }
    } catch (error) {
      console.error('Error fetching user list:', error);
    }
  }, [network?.api, currentPage, itemsPerPage]);

  useEffect(() => {
    if (searchResults === null) fetchUserList();
  }, [fetchUserList, searchResults]);

  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();

    const query = searchQuery.trim();
    if (!query) {
      setSearchError('Enter a public ID, account ID or organization ID');
      return;
    }

    setIsSearching(true);
    setSearchError('');

    try {
      const results = await network.api.adminSearchAccounts(query);
      setSearchResults(results);
      setCurrentPage(1);
      if (results.length === 0) setSearchError('No matching users');
    } catch (error) {
      console.error('Error searching for user:', error);
      setSearchError('Search failed');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleResetSearch = () => {
    setSearchQuery('');
    setSearchError('');
    setCurrentPage(1);
    setSearchResults(null);
  };

  const shownUsers = searchResults
    ? searchResults.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage,
      )
    : accountsWithUsers;

  // Total from the server for the user list, or from the local search results
  const totalPages = Math.ceil(
    (searchResults?.length ?? totalCount) / itemsPerPage,
  );

  // Pagination handlers
  const handlePageChange = (pageNumber: number) => {
    setCurrentPage(pageNumber);
  };

  const handleItemsPerPageChange = (items: number) => {
    setItemsPerPage(items);
    setCurrentPage(1); // Reset to first page when changing items per page
  };

  return (
    <div className='space-y-8'>
      <h1 className='text-2xl font-bold'>Admin Dashboard</h1>

      {/* Analytics Section */}
      <AdminStats />

      {/* Purchased Credits — dedicated screen */}
      <Link
        href={ROUTES.adminCredits(network.network.id)}
        className='flex items-center justify-between rounded-lg border border-gray-200 bg-background p-6 hover:bg-muted/30'
      >
        <div className='flex items-center gap-3'>
          <CreditCard className='h-5 w-5 text-muted-foreground' />
          <div>
            <h2 className='text-xl font-semibold'>Purchased Credits</h2>
            <p className='text-sm text-muted-foreground'>
              All credit batches, over-cap intents, and refund processing.
            </p>
          </div>
        </div>
        <ChevronRight className='h-5 w-5 text-muted-foreground' />
      </Link>

      {/* Reported Files — dedicated review queue */}
      <Link
        href={ROUTES.adminReported(network.network.id)}
        className='flex items-center justify-between rounded-lg border border-gray-200 bg-background p-6 hover:bg-muted/30'
      >
        <div className='flex items-center gap-3'>
          <Flag className='h-5 w-5 text-muted-foreground' />
          <div>
            <h2 className='text-xl font-semibold'>Reported Files</h2>
            <p className='text-sm text-muted-foreground'>
              Review files users have flagged, then dismiss the report or ban
              the file.
            </p>
          </div>
        </div>
        <ChevronRight className='h-5 w-5 text-muted-foreground' />
      </Link>

      {/* Users Section */}
      <div className='rounded-lg border border-gray-200 bg-background p-6'>
        <h2 className='mb-4 text-xl font-semibold'>Users</h2>

        <div className='mb-6'>
          <form onSubmit={handleSearchUser} className='flex items-end gap-2'>
            <div className='flex flex-col'>
              <label htmlFor='adminUserSearch' className='mb-1 text-sm'>
                Search users
              </label>
              <input
                id='adminUserSearch'
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Public ID (partial), account ID or organization ID'
                className='text-foreground-hover w-96 rounded border bg-background-hover px-3 py-2'
              />
            </div>
            <Button
              variant='primary'
              disabled={isSearching}
              className='text-foreground-hover rounded bg-background-hover px-4 py-2 hover:bg-background hover:text-foreground disabled:opacity-50'
            >
              {isSearching ? 'Searching...' : 'Search'}
            </Button>
            {(searchQuery || searchResults) && (
              <Button
                variant='danger'
                onClick={handleResetSearch}
                className='text-foreground-hover rounded bg-background-hover px-4 py-2 hover:bg-background hover:text-foreground'
              >
                Reset
              </Button>
            )}
          </form>
          {searchError && (
            <p className='text-light-danger mt-2'>{searchError}</p>
          )}
        </div>

        <div className='flex flex-col gap-2'>
          <UserAccountsTable
            users={shownUsers}
            currentPage={currentPage}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            onItemsPerPageChange={handleItemsPerPageChange}
          />
        </div>
      </div>
    </div>
  );
};

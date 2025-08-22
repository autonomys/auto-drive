'use client';

import { UserTableRow } from './UserTableRow';
import { SubscriptionInfoWithUser } from '@auto-drive/models';
import {
  TableBody,
  TableBodyCell,
  TableBodyRow,
} from 'components/common/Table/TableBody';
import { Table } from 'components/common/Table';
import {
  TableHead,
  TableHeadRow,
  TableHeadCell,
} from 'components/common/Table/TableHead';
import { ChevronLeft, ChevronRight, Loader } from 'lucide-react';

interface UserSubscriptionsTableProps {
  users: SubscriptionInfoWithUser[] | undefined;
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  onPageChange: (pageNumber: number) => void;
  onItemsPerPageChange: (items: number) => void;
}

export const UserSubscriptionsTable = ({
  users,
  currentPage,
  totalPages,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
}: UserSubscriptionsTableProps) => {
  return (
    <div>
      <div className='-my-2 sm:-mx-6 lg:-mx-8'>
        <div className='inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8'>
          <div className='border-b border-gray-200 shadow sm:rounded-lg'>
            <Table className='min-w-full'>
              <TableHead>
                <TableHeadRow>
                  <TableHeadCell>Public ID</TableHeadCell>
                  <TableHeadCell>Provider</TableHeadCell>
                  <TableHeadCell>Role</TableHeadCell>
                  <TableHeadCell>Granularity</TableHeadCell>
                  <TableHeadCell>Upload Credits</TableHeadCell>
                  <TableHeadCell>Pending Upload</TableHeadCell>
                  <TableHeadCell>Download Credits</TableHeadCell>
                  <TableHeadCell>Pending Download</TableHeadCell>
                  <TableHeadCell>Actions</TableHeadCell>
                </TableHeadRow>
              </TableHead>
              <TableBody>
                {users?.map((user) => (
                  <UserTableRow
                    key={user.user.publicId}
                    subscriptionWithUser={user}
                  />
                ))}
                {users === undefined && (
                  <TableBodyRow>
                    <TableBodyCell
                      colSpan={9}
                      className='whitespace-nowrap px-6 py-4 text-center text-sm text-foreground'
                    >
                      <span className='flex items-center justify-center'>
                        <Loader className='h-4 w-4 animate-spin' />
                      </span>
                    </TableBodyCell>
                  </TableBodyRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Pagination Controls */}
      <div className='mt-4 flex items-center justify-between border-t border-gray-200 bg-background px-4 py-3 sm:px-6 dark:bg-gray-800'>
        <div className='flex items-center'>
          <label
            htmlFor='itemsPerPage'
            className='mr-2 text-sm text-gray-700 dark:text-gray-300'
          >
            Show:
          </label>
          <select
            id='itemsPerPage'
            className='rounded border-gray-300 py-1 text-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700'
            value={itemsPerPage}
            onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>

        <div className='flex items-center'>
          <p className='text-sm text-gray-700 dark:text-gray-300'>
            Showing{' '}
            <span className='font-medium'>
              {users?.length ? (currentPage - 1) * itemsPerPage + 1 : 0}
            </span>{' '}
            to{' '}
            <span className='font-medium'>
              {Math.min(currentPage * itemsPerPage, users?.length || 0)}
            </span>{' '}
            of <span className='font-medium'>{users?.length || 0}</span> results
          </p>
        </div>

        <div className='flex items-center'>
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className='relative inline-flex items-center rounded-md border border-gray-300 bg-background px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
          >
            <ChevronLeft className='h-4 w-4' />
          </button>
          <span className='mx-2 text-sm text-gray-700 dark:text-gray-300'>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages || totalPages === 0}
            className='relative inline-flex items-center rounded-md border border-gray-300 bg-background px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
          >
            <ChevronRight className='h-4 w-4' />
          </button>
        </div>
      </div>
    </div>
  );
};

'use client';

import { UserTableRow } from './UserTableRow';
import { AccountInfoWithUser } from '@auto-drive/models';
import {
  TableBody,
  TableBodyCell,
  TableBodyRow,
} from '@/components/molecules/Table/TableBody';
import { Table } from '@/components/molecules/Table';
import {
  TableHead,
  TableHeadRow,
  TableHeadCell,
} from '@/components/molecules/Table/TableHead';
import { ChevronLeft, ChevronRight, Loader } from 'lucide-react';

interface UserAccountsTableProps {
  users: AccountInfoWithUser[] | undefined;
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  onPageChange: (pageNumber: number) => void;
  onItemsPerPageChange: (items: number) => void;
}

export const UserAccountsTable = ({
  users,
  currentPage,
  totalPages,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
}: UserAccountsTableProps) => {
  return (
    <div>
      <div className='-my-2 sm:-mx-6 lg:-mx-8'>
        <div className='inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8'>
          <div className='border-background-hover border-b shadow sm:rounded-lg'>
            <Table className='min-w-full'>
              <TableHead>
                <TableHeadRow>
                  <TableHeadCell>Public ID</TableHeadCell>
                  <TableHeadCell>Provider</TableHeadCell>
                  <TableHeadCell>Role</TableHeadCell>
                  <TableHeadCell>Model</TableHeadCell>
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
                    accountWithUser={user}
                  />
                ))}
                {users === undefined && (
                  <TableBodyRow>
                    <TableBodyCell
                      colSpan={9}
                      className='text-foreground-hover whitespace-nowrap px-6 py-4 text-center text-sm'
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
      <div className='border-background-hover mt-4 flex items-center justify-between border-t bg-background px-4 py-3 sm:px-6'>
        <div className='flex items-center'>
          <label
            htmlFor='itemsPerPage'
            className='text-foreground-hover mr-2 text-sm'
          >
            Show:
          </label>
          <select
            id='itemsPerPage'
            className='bg-background-hover text-foreground-hover rounded py-1 text-sm focus:border-indigo-500 focus:ring-indigo-500'
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
          <p className='text-foreground-hover text-sm'>
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
            className='border-background-hover text-foreground-hover hover:bg-background-hover relative inline-flex items-center rounded-md border bg-background px-2 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
          >
            <ChevronLeft className='h-4 w-4' />
          </button>
          <span className='text-foreground-hover mx-2 text-sm'>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages || totalPages === 0}
            className='border-background-hover text-foreground-hover hover:bg-background-hover relative inline-flex items-center rounded-md border bg-background px-2 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
          >
            <ChevronRight className='h-4 w-4' />
          </button>
        </div>
      </div>
    </div>
  );
};

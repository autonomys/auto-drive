'use client';

import { UserTableRow } from './UserTableRow';
import { SubscriptionWithUser } from '../../models/Subscriptions';
import {
  TableBody,
  TableBodyCell,
  TableBodyRow,
} from '../common/Table/TableBody';
import { Table } from '../common/Table';
import {
  TableHead,
  TableHeadRow,
  TableHeadCell,
} from '../common/Table/TableHead';
import { Loader } from 'lucide-react';

export const UserSubscriptionsTable = ({
  users,
}: {
  users: SubscriptionWithUser[] | undefined;
}) => {
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
                  <TableHeadCell>Download Credits</TableHeadCell>
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
                      colSpan={7}
                      className='dark:text-darkBlack whitespace-nowrap px-6 py-4 text-center text-sm text-black'
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
    </div>
  );
};

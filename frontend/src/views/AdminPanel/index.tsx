'use client';

import { AuthService } from '../../services/auth';
import { UserSubscriptionsTable } from '../../components/UserTable';
import { OnboardedUser } from '../../models/User';
import { useEffect } from 'react';

export const AdminPanel = ({ users }: { users: OnboardedUser[] }) => {
  useEffect(() => {
    console.log(AuthService.getUserList());
  });

  return (
    <div>
      <h1 className='mb-4 text-2xl font-bold'>Users</h1>
      <div className='flex flex-col gap-2'>
        <UserSubscriptionsTable users={users} />
      </div>
    </div>
  );
};

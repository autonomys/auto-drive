'use client';

import { useEffect, useState } from 'react';
import { ApiService } from '../../../services/api';
import { UserSubscriptionsTable } from '../../../components/UserTable';
import { SubscriptionWithUser } from '../../../models/Subscriptions';

export default function Page() {
  const [users, setUsers] = useState<SubscriptionWithUser[] | undefined>();

  useEffect(() => {
    ApiService.getUserList().then(setUsers);
  }, []);

  return (
    <div>
      <h1 className='mb-4 text-2xl font-bold'>Users</h1>
      <div className='flex flex-col gap-2'>
        <UserSubscriptionsTable users={users} />
      </div>
    </div>
  );
}

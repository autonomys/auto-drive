'use client';

import { AuthService } from '../../services/auth/auth';
import { UserSubscriptionsTable } from '../../components/UserTable';
import { useEffect, useState } from 'react';
import { ApiService } from '../../services/api';
import { SubscriptionWithUser } from '../../models/Subscriptions';

export const AdminPanel = () => {
  const [subscriptionsWithUsers, setSubscriptionsWithUsers] = useState<
    SubscriptionWithUser[]
  >([]);

  useEffect(() => {
    AuthService.getUserList().then((users) => {
      ApiService.getUserList(users.map((user) => user.publicId)).then(
        (subscriptionsByPublicId) => {
          const subscriptions = Object.entries(subscriptionsByPublicId);
          const subscriptionsWithUsers: SubscriptionWithUser[] =
            subscriptions.map(([publicId, subscription]) => ({
              ...subscription,
              user: users.find((user) => user.publicId === publicId)!,
            }));

          setSubscriptionsWithUsers(subscriptionsWithUsers);
        },
      );
    });
  }, []);

  return (
    <div>
      <h1 className='mb-4 text-2xl font-bold'>Users</h1>
      <div className='flex flex-col gap-2'>
        <UserSubscriptionsTable users={subscriptionsWithUsers} />
      </div>
    </div>
  );
};

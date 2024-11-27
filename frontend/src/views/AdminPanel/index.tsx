import { UserSubscriptionsTable } from '../../components/UserTable';
import { SubscriptionWithUser } from '../../models/Subscriptions';

export const AdminPanel = ({ users }: { users: SubscriptionWithUser[] }) => {
  return (
    <div>
      <h1 className='mb-4 text-2xl font-bold'>Users</h1>
      <div className='flex flex-col gap-2'>
        <UserSubscriptionsTable users={users} />
      </div>
    </div>
  );
};

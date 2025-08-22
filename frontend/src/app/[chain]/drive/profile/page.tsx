import { Profile } from '@/components/views/Profile';
import { UserProtectedLayout } from '../../../../components/layouts/UserProtectedLayout';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <Profile />
    </UserProtectedLayout>
  );
}

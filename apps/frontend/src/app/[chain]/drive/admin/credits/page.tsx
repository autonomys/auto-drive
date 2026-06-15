import { AdminCredits } from '@/components/views/AdminPanel/AdminCredits';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <AdminCredits />
    </UserProtectedLayout>
  );
}

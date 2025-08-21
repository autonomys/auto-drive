import { AdminPanel } from '@/components/views/AdminPanel';
import { UserProtectedLayout } from '../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <AdminPanel />
    </UserProtectedLayout>
  );
}

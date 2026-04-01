import { DeletionAdmin } from '@/components/views/DeletionAdmin';
import { UserProtectedLayout } from '../../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <DeletionAdmin />
    </UserProtectedLayout>
  );
}

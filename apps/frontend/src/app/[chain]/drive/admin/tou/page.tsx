import { TouAdmin } from '@/components/views/TouAdmin';
import { UserProtectedLayout } from '../../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <TouAdmin />
    </UserProtectedLayout>
  );
}

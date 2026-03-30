import { BannerAdmin } from '@/components/views/BannerAdmin';
import { UserProtectedLayout } from '../../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <BannerAdmin />
    </UserProtectedLayout>
  );
}

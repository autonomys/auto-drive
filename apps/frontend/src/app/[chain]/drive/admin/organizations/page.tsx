import { PartnerOrganizations } from '@/components/views/AdminPanel/PartnerOrganizations';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <PartnerOrganizations />
    </UserProtectedLayout>
  );
}

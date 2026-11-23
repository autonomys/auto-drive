import { OrganizationApiKeysView } from '@/components/views/Organization';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <OrganizationApiKeysView />
    </UserProtectedLayout>
  );
}

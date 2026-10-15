import { OrganizationDetails } from '@/components/views/AdminPanel/OrganizationDetails';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <UserProtectedLayout>
      <OrganizationDetails organizationId={id} />
    </UserProtectedLayout>
  );
}


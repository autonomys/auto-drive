import { AdminUserCredits } from '@/components/views/AdminPanel/AdminUserCredits';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ userPublicId: string }>;
}) {
  const { userPublicId } = await params;

  return (
    <UserProtectedLayout>
      <AdminUserCredits userPublicId={decodeURIComponent(userPublicId)} />
    </UserProtectedLayout>
  );
}

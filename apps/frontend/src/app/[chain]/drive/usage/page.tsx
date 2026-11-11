import { AccountUsage } from '@/components/views/UsageReport/AccountUsage';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <AccountUsage />
    </UserProtectedLayout>
  );
}

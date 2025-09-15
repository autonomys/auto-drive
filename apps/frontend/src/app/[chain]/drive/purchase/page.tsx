import { PurchaseCredits } from '@/components/views/PurchaseCredits';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <PurchaseCredits />
    </UserProtectedLayout>
  );
}

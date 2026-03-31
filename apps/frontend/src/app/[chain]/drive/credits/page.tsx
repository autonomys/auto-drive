import { CreditHistoryView } from '@/components/views/CreditHistory';
import { UserProtectedLayout } from '../../../../components/layouts/UserProtectedLayout';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <CreditHistoryView />
    </UserProtectedLayout>
  );
}

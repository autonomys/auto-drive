import { UserFiles } from '@/components/views/UserFiles';
import { UserProtectedLayout } from '@/components/layouts/UserProtectedLayout';

export default function Page() {
  return (
    <UserProtectedLayout>
      <UserFiles />
    </UserProtectedLayout>
  );
}

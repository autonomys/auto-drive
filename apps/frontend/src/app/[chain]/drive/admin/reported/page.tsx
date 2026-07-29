import { ReportedFiles } from '@/components/views/ReportedFiles';
import { UserProtectedLayout } from '../../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <UserProtectedLayout>
      <ReportedFiles />
    </UserProtectedLayout>
  );
}

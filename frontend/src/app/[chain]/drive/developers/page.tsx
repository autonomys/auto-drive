import { AuthService } from 'services/auth/auth';
import { Developers } from '@/components/views/Developers';
import { UserProtectedLayout } from '../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

const Page = async () => {
  const apiKeys = await AuthService.getApiKeys();

  return (
    <UserProtectedLayout>
      <Developers apiKeys={apiKeys} />
    </UserProtectedLayout>
  );
};

export default Page;

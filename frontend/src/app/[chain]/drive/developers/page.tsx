import { AuthService } from 'services/auth/auth';
import { Developers } from '@/components/Developers';

export const dynamic = 'force-dynamic';

const Page = async () => {
  const apiKeys = await AuthService.getApiKeys();

  return <Developers apiKeys={apiKeys} />;
};

export default Page;

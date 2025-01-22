import { Profile } from '../../../views/Profile';
import { AuthService } from '../../../services/auth/auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const apiKeys = await AuthService.getApiKeys();

  return <Profile apiKeys={apiKeys} />;
}

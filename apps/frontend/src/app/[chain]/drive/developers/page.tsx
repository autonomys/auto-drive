import { AuthService } from 'services/auth/auth';
import { Developers } from '@/components/views/Developers';
import { UserProtectedLayout } from '../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

// `?newKey=<name>` opens the create dialog with the name prefilled, so an app
// can send its users straight to issuing a key for it.
const parseNewKeyName = (raw: string | string[] | undefined) => {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 64) : '';
  return name.length > 0 ? name : undefined;
};

const Page = async ({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const apiKeys = await AuthService.getApiKeys();

  return (
    <UserProtectedLayout>
      <Developers
        apiKeys={apiKeys}
        newKeyName={parseNewKeyName(searchParams?.newKey)}
      />
    </UserProtectedLayout>
  );
};

export default Page;

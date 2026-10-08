import { redirect } from 'next/navigation';
import { AuthService, UserNotOnboardedError } from 'services/auth/auth';
import { CALLBACK_URL_PARAM } from 'utils/callbackUrl';
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
  params,
  searchParams,
}: {
  params: { chain: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const newKeyName = parseNewKeyName(searchParams?.newKey);

  // A first-time user arriving from a deep link must onboard before keys can
  // be listed; send them through onboarding and back here afterwards.
  const apiKeys = await AuthService.getApiKeys().catch((error) => {
    if (!(error instanceof UserNotOnboardedError)) throw error;
    const query = newKeyName
      ? `?${new URLSearchParams({ newKey: newKeyName })}`
      : '';
    const here = `/${params.chain}/drive/developers${query}`;
    redirect(`/onboarding?${CALLBACK_URL_PARAM}=${encodeURIComponent(here)}`);
  });

  return (
    <UserProtectedLayout>
      <Developers apiKeys={apiKeys} newKeyName={newKeyName} />
    </UserProtectedLayout>
  );
};

export default Page;

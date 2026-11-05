import { ConnectApp } from '@/components/views/ConnectApp';
import {
  parseConnectAppName,
  parseConnectState,
  parseExtensionRedirectUri,
} from 'utils/connectApp';
import { UserProtectedLayout } from '../../../../components/layouts/UserProtectedLayout';

export const dynamic = 'force-dynamic';

const Page = ({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const appName = parseConnectAppName(searchParams?.app_name);
  const redirectTarget = parseExtensionRedirectUri(searchParams?.redirect_uri);
  const state = parseConnectState(searchParams?.state);

  return (
    <UserProtectedLayout>
      <ConnectApp
        appName={appName}
        redirectTarget={redirectTarget}
        state={state}
      />
    </UserProtectedLayout>
  );
};

export default Page;

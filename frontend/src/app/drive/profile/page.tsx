import { getServerSession } from 'next-auth';
import { Profile } from '../../../views/Profile';
import { authOptions } from '../../api/auth/[...nextauth]/config';
import { redirect } from 'next/navigation';
import { apiv2Client } from '../../../services/gql';
import { GetProfileQueryText } from '../../../views/Profile/query';
import { GetProfileQuery } from '../../../../gql/graphql';

const getApiKeysFromResult = (user: GetProfileQuery['users'][number]) => {
  return (user?.api_keys || []).map((apiKey) => ({
    id: apiKey.id,
    oauthProvider: apiKey.oauth_provider,
    oauthUserId: apiKey.oauth_user_id,
    createdAt: new Date(apiKey.created_at),
  }));
};

export default async function Page() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const { data } = await apiv2Client.query<GetProfileQuery>({
    query: GetProfileQueryText,
    variables: {},
    context: {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    },
    fetchPolicy: 'no-cache',
  });

  const apiKeys = getApiKeysFromResult(data.users[0]);

  return <Profile apiKeys={apiKeys} />;
}

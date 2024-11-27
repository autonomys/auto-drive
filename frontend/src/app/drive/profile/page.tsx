import { Profile } from '../../../views/Profile';
import { getGqlSSRClient } from '../../../services/gql';
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
  const client = await getGqlSSRClient();
  const { data } = await client.query<GetProfileQuery>({
    query: GetProfileQueryText,
    variables: {},
    fetchPolicy: 'no-cache',
  });

  const apiKeys = getApiKeysFromResult(data.users[0]);

  return <Profile apiKeys={apiKeys} />;
}

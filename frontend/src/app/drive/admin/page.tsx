import { GetAllUsersWithSubscriptionsQuery } from '../../../../gql/graphql';
import { apiv2Client } from '../../../services/gql';
import { GET_ALL_USERS_WITH_SUBSCRIPTIONS } from '../../../services/gql/common/query';
import { mapUsersFromQueryResult } from '../../../services/gql/utils';
import { AdminPanel } from '../../../views/AdminPanel';

export default async function Page() {
  const { data } = await apiv2Client.query<GetAllUsersWithSubscriptionsQuery>({
    query: GET_ALL_USERS_WITH_SUBSCRIPTIONS,
    fetchPolicy: 'network-only',
  });

  const users = mapUsersFromQueryResult(data);

  return <AdminPanel users={users} />;
}

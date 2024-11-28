import { GetAllUsersWithSubscriptionsQuery } from '../../../../gql/graphql';
import { gqlClient } from '../../../services/gql';
import { GET_ALL_USERS_WITH_SUBSCRIPTIONS } from '../../../services/gql/common/query';
import { mapUsersFromQueryResult } from '../../../services/gql/utils';
import { AdminPanel } from '../../../views/AdminPanel';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { data } = await gqlClient.query<GetAllUsersWithSubscriptionsQuery>({
    query: GET_ALL_USERS_WITH_SUBSCRIPTIONS,
    fetchPolicy: 'network-only',
  });

  const users = mapUsersFromQueryResult(data);

  return <AdminPanel users={users} />;
}

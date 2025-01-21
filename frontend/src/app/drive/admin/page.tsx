import { GetAllUsersWithSubscriptionsQuery } from '../../../../gql/graphql';
import { AuthService } from '../../../services/auth';
import { gqlClient } from '../../../services/gql';
import { GET_ALL_USERS_WITH_SUBSCRIPTIONS } from '../../../services/gql/common/query';
import { mapUsersFromQueryResult } from '../../../services/gql/utils';
import { AdminPanel } from '../../../views/AdminPanel';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return <AdminPanel users={[]} />;
}

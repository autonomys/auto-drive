import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { getAuthSession } from 'utils/auth';
import { NetworkId, getNetwork } from '@auto-drive/ui';

const authLink = setContext(async (_, { headers }) => {
  const token = await getAuthSession();

  return {
    headers: {
      ...headers,
      // Signed-in requests use the token's default role (`app-admin` for
      // admins, `user` otherwise)
      ...(token
        ? { authorization: `Bearer ${token.accessToken}` }
        : { 'X-Hasura-Role': 'anonymous' }),
    },
  };
});

export const createGQLClient = (apiBaseUrl: string) =>
  new ApolloClient({
    cache: new InMemoryCache(),
    link: authLink.concat(new HttpLink({ uri: apiBaseUrl })),
  });

export const createGQLClientByNetwork = (networkId: NetworkId) =>
  createGQLClient(getNetwork(networkId).gql);

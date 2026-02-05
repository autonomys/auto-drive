import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import { getAuthSession } from 'utils/auth';
import { NetworkId, getNetwork } from '@auto-drive/ui';

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path }) =>
      console.error(
        `[GQL] GraphQL error: ${message}`,
        locations ? `Location: ${JSON.stringify(locations)}` : '',
        path ? `Path: ${path}` : '',
      ),
    );
  }
  if (networkError) {
    console.error('[GQL] Network error:', networkError);
  }
});

const authLink = setContext(async (_, { headers }) => {
  const token = await getAuthSession().catch(() => null);
  const role = token ? 'user' : 'anonymous';

  return {
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token.accessToken}` } : {}),
      'X-Hasura-Role': role,
    },
  };
});

export const createGQLClient = (apiBaseUrl: string) => {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: from([errorLink, authLink, new HttpLink({ uri: apiBaseUrl })]),
  });
};

export const createGQLClientByNetwork = (networkId: NetworkId) =>
  createGQLClient(getNetwork(networkId).gql);

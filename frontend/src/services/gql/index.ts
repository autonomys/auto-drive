import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { getAuthSession } from 'utils/auth';
import { NetworkId, getNetwork } from 'constants/networks';

const authLink = setContext(async (_, { headers }) => {
  const token = await getAuthSession();

  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token.accessToken}` : '',
    },
  };
});

export const createGQLClient = (apiBaseUrl: string) =>
  new ApolloClient({
    uri: apiBaseUrl,
    cache: new InMemoryCache(),
    link: authLink.concat(new HttpLink({ uri: apiBaseUrl })),
  });

export const createGQLClientByNetwork = (networkId: NetworkId) =>
  createGQLClient(getNetwork(networkId).gql);

import { ApolloClient, createHttpLink, InMemoryCache } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { getAuthSession } from '../../utils/auth';

const authLink = setContext(async (_, { headers }) => {
  const token = await getAuthSession();

  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token.accessToken}` : '',
    },
  };
});

const httpLink = createHttpLink({
  uri: process.env.NEXT_PUBLIC_GQL_URL,
});

export const gqlClient = new ApolloClient({
  uri: process.env.NEXT_PUBLIC_GQL_URL,
  cache: new InMemoryCache(),
  link: authLink.concat(httpLink),
});

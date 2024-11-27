import { ApolloClient, createHttpLink, InMemoryCache } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { getAuthSession } from '../../utils/auth';
import { getSession } from 'next-auth/react';

const httpLink = createHttpLink({
  uri: process.env.NEXT_PUBLIC_GQL_URL,
});

export const gqlSSRClient = new ApolloClient({
  uri: process.env.NEXT_PUBLIC_GQL_URL,
  cache: new InMemoryCache(),
  ssrMode: true,
});

export const getGqlSSRClient = async () => {
  const token = await getAuthSession();

  const ssrTokenLink = setContext(async (_, { headers }) => {
    return {
      headers: {
        ...headers,
        authorization: token ? `Bearer ${token.accessToken}` : '',
      },
    };
  });

  gqlSSRClient.setLink(ssrTokenLink.concat(httpLink));

  return gqlSSRClient;
};

const csrTokenLink = setContext(async (_, { headers }) => {
  const token = await getSession();
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token.accessToken}` : '',
    },
  };
});

export const gqlCSRClient = new ApolloClient({
  uri: process.env.NEXT_PUBLIC_GQL_URL,
  cache: new InMemoryCache(),
  ssrMode: false,
  link: csrTokenLink.concat(httpLink),
});

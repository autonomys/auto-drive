import { ApolloClient, InMemoryCache } from '@apollo/client';

export const apiv2Client = new ApolloClient({
  uri: process.env.NEXT_PUBLIC_GQL_URL,
  cache: new InMemoryCache(),
});

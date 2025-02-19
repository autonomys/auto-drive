import { SearchResult } from '@/components/SearchResult';
import { createGQLClientByNetwork } from 'services/gql';
import {
  SearchGlobalMetadataByCidOrNameDocument,
  SearchGlobalMetadataByCidOrNameQuery,
} from 'gql/graphql';
import { NetworkId } from 'constants/networks';

export const dynamic = 'force-dynamic';

export default async function Page({
  params: { cid, chain },
}: {
  params: { cid: string; chain: NetworkId };
}) {
  const gqlClient = createGQLClientByNetwork(chain);

  const { data } = await gqlClient.query<SearchGlobalMetadataByCidOrNameQuery>({
    query: SearchGlobalMetadataByCidOrNameDocument,
    variables: {
      search: `%${decodeURIComponent(cid)}%`,
      limit: 100,
    },
  });

  const objects = data.metadata.map((metadata) => ({
    type: metadata.type,
    name: metadata.name ?? '',
    size: metadata.size,
    cid: metadata.cid,
  }));

  return <SearchResult objects={objects} />;
}

import { SearchResult } from '../../../../../views/SearchResult';
import { SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME } from '../../../../../services/gql/common/query';
import { createGQLClientByNetwork } from '../../../../../services/gql';
import { SearchGlobalMetadataByCidOrNameQuery } from '../../../../../../gql/graphql';
import { NetworkId } from '../../../../../constants/networks';

export const dynamic = 'force-dynamic';

export default async function Page({
  params: { cid, chain },
}: {
  params: { cid: string; chain: NetworkId };
}) {
  const gqlClient = createGQLClientByNetwork(chain);

  const { data } = await gqlClient.query<SearchGlobalMetadataByCidOrNameQuery>({
    query: SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME,
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

import { SearchResult } from '../../../../views/SearchResult';
import { SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME } from '../../../../services/gql/common/query';
import { SearchGlobalMetadataByCidOrNameQuery } from '../../../../../gql/graphql';
import { getGqlSSRClient } from '../../../../services/gql';

export default async function Page({
  params: { cid },
}: {
  params: { cid: string };
}) {
  const client = await getGqlSSRClient();

  const { data } = await client.query<SearchGlobalMetadataByCidOrNameQuery>({
    query: SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME,
    variables: {
      search: cid,
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

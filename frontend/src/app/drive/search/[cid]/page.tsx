import { SearchResult } from '../../../../views/SearchResult';
import { SEARCH_GLOBAL_METADATA_BY_CID_OR_NAME } from '../../../../services/gql/common/query';
import { gqlClient } from '../../../../services/gql';
import { SearchGlobalMetadataByCidOrNameQuery } from '../../../../../gql/graphql';

export default async function Page({
  params: { cid },
}: {
  params: { cid: string };
}) {
  const { data } = await gqlClient.query<SearchGlobalMetadataByCidOrNameQuery>({
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

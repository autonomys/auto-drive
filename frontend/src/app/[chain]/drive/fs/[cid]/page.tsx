import { createGQLClientByNetwork } from 'services/gql';
import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from 'gql/graphql';
import { mapObjectInformationFromQueryResult } from 'services/gql/utils';
import { NetworkId } from 'constants/networks';
import { FS } from '@/components/FileSystem';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: { cid: string; chain: string };
}) {
  const gqlClient = createGQLClientByNetwork(params.chain as NetworkId);

  const { data } = await gqlClient.query<GetMetadataByHeadCidQuery>({
    query: GetMetadataByHeadCidDocument,
    variables: { headCid: params.cid },
  });

  const objInfo = mapObjectInformationFromQueryResult(data);

  return <FS information={objInfo} />;
}

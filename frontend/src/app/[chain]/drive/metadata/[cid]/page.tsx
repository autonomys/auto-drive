import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from 'gql/graphql';
import { ObjectDetails } from '@/components/ObjectDetails';
import { mapObjectInformationFromQueryResult } from 'services/gql/utils';
import { NetworkId } from 'constants/networks';
import { createGQLClientByNetwork } from 'services/gql';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ cid: string; chain: NetworkId }>;
}) {
  const { chain, cid } = await params;

  const gqlClient = createGQLClientByNetwork(chain);

  const { data } = await gqlClient.query<GetMetadataByHeadCidQuery>({
    query: GetMetadataByHeadCidDocument,
    variables: { headCid: cid },
  });

  const metadata = mapObjectInformationFromQueryResult(data);

  return <ObjectDetails metadata={metadata} />;
}

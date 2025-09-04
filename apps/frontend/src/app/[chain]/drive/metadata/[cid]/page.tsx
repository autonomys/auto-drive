import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
  GetMetadataByHeadCidWithOwnershipDocument,
  GetMetadataByHeadCidWithOwnershipQuery,
} from 'gql/graphql';
import { ObjectDetails } from '@/components/organisms/ObjectDetails';
import {
  mapObjectInformationFromQueryResult,
  mapObjectInformationFromQueryResultWithOwnership,
} from 'services/gql/utils';
import { NetworkId } from '@auto-drive/ui';
import { createGQLClientByNetwork } from 'services/gql';
import { getServerSession } from 'next-auth';

export const dynamic = 'force-dynamic';

const getMetadata = async (cid: string, chain: NetworkId) => {
  const gqlClient = createGQLClientByNetwork(chain);
  const session = await getServerSession();

  if (session) {
    const { data } =
      await gqlClient.query<GetMetadataByHeadCidWithOwnershipQuery>({
        query: GetMetadataByHeadCidWithOwnershipDocument,
        variables: { headCid: cid },
      });

    return mapObjectInformationFromQueryResultWithOwnership(data);
  } else {
    const { data } = await gqlClient.query<GetMetadataByHeadCidQuery>({
      query: GetMetadataByHeadCidDocument,
      variables: { headCid: cid },
    });

    return mapObjectInformationFromQueryResult(data);
  }
};

export default async function Page({
  params: { cid, chain },
}: {
  params: { cid: string; chain: NetworkId };
}) {
  const metadata = await getMetadata(cid, chain);

  return <ObjectDetails object={metadata} />;
}

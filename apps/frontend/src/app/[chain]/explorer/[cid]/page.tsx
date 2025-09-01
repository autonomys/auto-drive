import { createGQLClientByNetwork } from '@/services/gql';
import { NetworkId } from '@auto-drive/ui';
import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from '../../../../../gql/graphql';
import { mapObjectInformationFromQueryResult } from '../../../../services/gql/utils';
import { PublicFileDetails } from '../../../../components/views/PublicFileDetails';

export default async function ExplorerPage({
  params: { cid, chain },
}: {
  params: { cid: string; chain: NetworkId };
}) {
  const gqlClient = createGQLClientByNetwork(chain);

  const { data } = await gqlClient.query<GetMetadataByHeadCidQuery>({
    query: GetMetadataByHeadCidDocument,
    variables: { headCid: cid },
  });

  const objectInformation = mapObjectInformationFromQueryResult(data);

  return <PublicFileDetails objectInformation={objectInformation} />;
}

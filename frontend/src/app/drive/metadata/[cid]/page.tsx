import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from '../../../../../gql/graphql';
import { ObjectDetails } from '../../../../views/ObjectDetails';
import { apiv2Client } from '../../../../services/gql';
import { mapObjectInformationFromQueryResult } from '../../../../services/gql/utils';

export default async function Page({ params }: { params: { cid: string } }) {
  const { data } = await apiv2Client.query<GetMetadataByHeadCidQuery>({
    query: GetMetadataByHeadCidDocument,
    variables: { headCid: params.cid },
  });

  const metadata = mapObjectInformationFromQueryResult(data);

  return <ObjectDetails metadata={metadata} />;
}

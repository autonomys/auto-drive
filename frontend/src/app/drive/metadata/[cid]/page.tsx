import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from '../../../../../gql/graphql';
import { ObjectDetails } from '../../../../views/ObjectDetails';
import { gqlClient } from '../../../../services/gql';
import { mapObjectInformationFromQueryResult } from '../../../../services/gql/utils';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: { cid: string } }) {
  const { data } = await gqlClient.query<GetMetadataByHeadCidQuery>({
    query: GetMetadataByHeadCidDocument,
    variables: { headCid: params.cid },
  });

  const metadata = mapObjectInformationFromQueryResult(data);

  return <ObjectDetails metadata={metadata} />;
}

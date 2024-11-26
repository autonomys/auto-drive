import { GetMetadataByHeadCidDocument } from '../../../../../gql/graphql';
import { ObjectDetails } from '../../../../views/ObjectDetails';
import { apiv2Client } from '../../../../services/gql';
import { authOptions } from '../../../api/auth/[...nextauth]/config';
import { getServerSession } from 'next-auth/next';
import { mapObjectInformationFromQueryResult } from '../../../../services/gql/utils';

export default async function Page({ params }: { params: { cid: string } }) {
  const session = await getServerSession(authOptions);
  const { data } = await apiv2Client.query({
    query: GetMetadataByHeadCidDocument,
    variables: { headCid: params.cid },
    context: {
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
      },
    },
  });

  const metadata = mapObjectInformationFromQueryResult(data);

  return <ObjectDetails metadata={metadata} />;
}

import { FileCard } from '../../../../components/common/FileCard';
import { getServerSession } from 'next-auth/next';
import { apiv2Client } from '../../../../services/gql';
import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from '../../../../../gql/graphql';
import { authOptions } from '../../../api/auth/[...nextauth]/config';
import { mapObjectInformationFromQueryResult } from '../../../../services/gql/utils';

export default async function Page({ params }: { params: { cid: string } }) {
  const session = await getServerSession(authOptions);
  const { data } = await apiv2Client.query<GetMetadataByHeadCidQuery>({
    query: GetMetadataByHeadCidDocument,
    variables: { headCid: params.cid },
    context: {
      headers: {
        Authorization: `Bearer ${session?.accessToken}`,
      },
    },
  });

  const metadata = mapObjectInformationFromQueryResult(data);
  if (metadata.metadata.type === 'file') {
    throw new Error('File type not supported');
  }

  return (
    <div className='grid grid-cols-4 gap-4'>
      {metadata.metadata.children.map((metadata) => {
        return <FileCard key={metadata.cid} metadata={metadata} />;
      })}
    </div>
  );
}

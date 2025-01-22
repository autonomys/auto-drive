import { FileCard } from '../../../../../components/common/FileCard';
import { createGQLClientByNetwork } from '../../../../../services/gql';
import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from '../../../../../../gql/graphql';
import { mapObjectInformationFromQueryResult } from '../../../../../services/gql/utils';
import { NetworkId } from '../../../../../constants/networks';

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

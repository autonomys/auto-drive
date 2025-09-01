import { createGQLClientByNetwork } from 'services/gql';
import {
  GetMetadataByHeadCidDocument,
  GetMetadataByHeadCidQuery,
} from 'gql/graphql';
import { mapObjectInformationFromQueryResult } from 'services/gql/utils';
import { NetworkId } from '@auto-drive/ui';
import { FS } from '@/components/views/FileSystem';
import { UserProtectedLayout } from '../../../../../components/layouts/UserProtectedLayout';

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

  return (
    <UserProtectedLayout>
      <FS information={objInfo} />
    </UserProtectedLayout>
  );
}

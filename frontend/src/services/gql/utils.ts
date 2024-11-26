import { GetMetadataByHeadCidQuery } from '../../../gql/graphql';
import {
  OwnerRole,
  UploadedObjectMetadata,
} from '../../models/UploadedObjectMetadata';

export const mapObjectInformationFromQueryResult = (
  result: GetMetadataByHeadCidQuery,
): UploadedObjectMetadata => {
  const metadata = result.metadata[0];
  return {
    metadata: metadata.metadata,
    uploadStatus: {
      uploadedNodes: metadata.publishedNodes?.aggregate?.count ?? 0,
      totalNodes: metadata.totalNodes?.aggregate?.count ?? 0,
      archivedNodes: metadata.archivedNodes?.aggregate?.count ?? 0,
      minimumBlockDepth:
        metadata.minimumBlockDepth[0]?.transaction_result?.blockNumber ?? null,
      maximumBlockDepth:
        metadata.maximumBlockDepth[0]?.transaction_result?.blockNumber ?? null,
    },
    owners: metadata.object_ownership.map((owner) => ({
      publicId: owner.user?.public_id ?? '',
      role: owner.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
    })),
  };
};

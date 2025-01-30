import { GetTrashedFilesQuery } from '../../../gql/graphql';
import { ObjectSummary, OwnerRole } from '../../models/UploadedObjectMetadata';

export const objectSummaryFromTrashedFilesQuery = (
  e: GetTrashedFilesQuery,
): ObjectSummary[] => {
  return e.metadata.map((m) => ({
    headCid: m.root_metadata!.cid,
    size: m.root_metadata?.size ?? 0,
    owners: m.root_metadata!.object_ownership.map((o) => ({
      oauthProvider: o.oauth_provider,
      oauthUserId: o.oauth_user_id,
      role: o.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
    })),
    type: m.root_metadata?.type,
    name: m.root_metadata?.name,
    mimeType: m.root_metadata?.mimeType,
    children: m.root_metadata?.children,
    publishedObjectId: null,
    uploadStatus: {
      uploadedNodes: m.root_metadata!.publishedNodes.aggregate?.count ?? 0,
      archivedNodes: m.root_metadata!.archivedNodes.aggregate?.count ?? 0,
      totalNodes: m.root_metadata!.totalNodes.aggregate?.count ?? 0,
      minimumBlockDepth:
        m.root_metadata!.minimumBlockDepth?.[0]?.transaction_result
          ?.blockNumber ?? null,
      maximumBlockDepth:
        m.root_metadata!.maximumBlockDepth?.[0]?.transaction_result
          ?.blockNumber ?? null,
    },
  }));
};

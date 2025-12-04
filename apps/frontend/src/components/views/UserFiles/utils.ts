import { GetMyFilesQuery } from 'gql/graphql';
import { objectStatus, ObjectSummary, OwnerRole } from '@auto-drive/models';

export const objectSummaryFromUserFilesQuery = (
  e: GetMyFilesQuery,
): ObjectSummary[] => {
  return e.object_ownership
    .filter((o) => o.metadata !== null)
    .map((o) => {
      const m = o.metadata!;
      const uploadState = {
        uploadedNodes: m.publishedNodes.aggregate?.count ?? 0,
        archivedNodes: m.archivedNodes.aggregate?.count ?? 0,
        totalNodes: m.totalNodes.aggregate?.count ?? 0,
        minimumBlockDepth: null,
        maximumBlockDepth: null,
      };
      return {
        headCid: m.cid ?? '',
        tags: m.tags ?? [],
        size: m.size ?? 0,
        owners: [
          {
            oauthProvider: o.oauth_provider,
            oauthUserId: o.oauth_user_id,
            role: o.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
          },
        ],
        type: m.type,
        name: m.name,
        mimeType: m.mimeType,
        children: m.children,
        publishedObjectId: m.published_objects?.id ?? null,
        createdAt: m.created_at,
        uploadState: uploadState,
        status: objectStatus(uploadState),
      };
    });
};

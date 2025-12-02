import { GetGlobalFilesQuery } from 'gql/graphql';
import { objectStatus, ObjectSummary } from '@auto-drive/models';

export const objectSummaryFromGlobalFilesQuery = (
  e: GetGlobalFilesQuery,
): ObjectSummary[] => {
  return e.metadata_roots.map((m) => {
    const uploadState = {
      uploadedNodes: m.inner_metadata!.publishedNodes?.aggregate?.count ?? 0,
      archivedNodes: m.inner_metadata!.archivedNodes?.aggregate?.count ?? 0,
      totalNodes: m.inner_metadata!.totalNodes?.aggregate?.count ?? 0,
      minimumBlockDepth: null,
      maximumBlockDepth: null,
    };
    return {
      headCid: m.cid ?? '',
      tags: m.tags ?? [],
      size: m.size ?? 0,
      owners: [],
      type: m.type,
      name: m.name,
      mimeType: m.mimeType,
      children: m.children,
      publishedObjectId: null,
      createdAt: m.createdAt,
      status: objectStatus(uploadState),
      uploadState,
    };
  });
};

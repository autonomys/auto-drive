import {
  GetMetadataByHeadCidQuery,
  GetMetadataByHeadCidWithOwnershipQuery,
} from 'gql/graphql';
import { ObjectInformation, OwnerRole, objectStatus } from '@auto-drive/models';

export const mapObjectInformationFromQueryResult = (
  result: GetMetadataByHeadCidQuery,
): ObjectInformation => {
  const metadata = result.metadata.at(0);
  if (!metadata) {
    throw new Error('Metadata not found');
  }

  const uploadState = {
    uploadedNodes: metadata.publishedNodes?.aggregate?.count ?? 0,
    totalNodes: metadata.totalNodes?.aggregate?.count ?? 0,
    archivedNodes: metadata.archivedNodes?.aggregate?.count ?? 0,
    minimumBlockDepth:
      metadata.minimumBlockDepth?.[0]?.block_published_on ?? null,
    maximumBlockDepth:
      metadata.maximumBlockDepth?.[0]?.block_published_on ?? null,
  };

  return {
    cid: metadata.head_cid,
    metadata: metadata.metadata,
    createdAt: metadata.created_at,
    status: objectStatus(uploadState),
    uploadState,
    tags: metadata.tags ?? [],
    owners: [],
    publishedObjectId: null,
  };
};

export const mapObjectInformationFromQueryResultWithOwnership = (
  result: GetMetadataByHeadCidWithOwnershipQuery,
): ObjectInformation => {
  const metadata = result.metadata.at(0);
  if (!metadata) {
    throw new Error('Metadata not found');
  }

  const uploadState = {
    uploadedNodes: metadata.publishedNodes?.aggregate?.count ?? 0,
    totalNodes: metadata.totalNodes?.aggregate?.count ?? 0,
    archivedNodes: metadata.archivedNodes?.aggregate?.count ?? 0,
    minimumBlockDepth:
      metadata.minimumBlockDepth?.[0]?.block_published_on ?? null,
    maximumBlockDepth:
      metadata.maximumBlockDepth?.[0]?.block_published_on ?? null,
  };

  return {
    cid: metadata.head_cid,
    metadata: metadata.metadata,
    createdAt: metadata.created_at,
    status: objectStatus(uploadState),
    uploadState,
    tags: metadata.tags ?? [],
    owners: metadata.object_ownership?.map((owner) => ({
      role: owner.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
      oauthProvider: owner.oauth_provider ?? '',
      oauthUserId: owner.oauth_user_id ?? '',
    })),
    publishedObjectId: null,
  };
};

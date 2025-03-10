import {
  GetAllUsersWithSubscriptionsQuery,
  GetMetadataByHeadCidQuery,
} from 'gql/graphql';
import {
  SubscriptionGranularity,
  SubscriptionWithUser,
  UserRole,
  ObjectInformation,
  OwnerRole,
} from '@auto-drive/models';

export const mapObjectInformationFromQueryResult = (
  result: GetMetadataByHeadCidQuery,
): ObjectInformation => {
  const metadata = result.metadata.at(0);
  if (!metadata) {
    throw new Error('Metadata not found');
  }

  return {
    cid: metadata.head_cid,
    metadata: metadata.metadata,
    createdAt: metadata.created_at,
    uploadStatus: {
      uploadedNodes: metadata.publishedNodes?.aggregate?.count ?? 0,
      totalNodes: metadata.totalNodes?.aggregate?.count ?? 0,
      archivedNodes: metadata.archivedNodes?.aggregate?.count ?? 0,
      minimumBlockDepth:
        metadata.minimumBlockDepth?.[0]?.block_published_on ?? null,
      maximumBlockDepth:
        metadata.maximumBlockDepth?.[0]?.block_published_on ?? null,
    },
    owners: metadata.object_ownership.map((owner) => ({
      role: owner.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
      oauthProvider: owner.oauth_provider ?? '',
      oauthUserId: owner.oauth_user_id ?? '',
    })),
    publishedObjectId: metadata.published_objects?.id ?? null,
  };
};

export const mapUsersFromQueryResult = (
  result: GetAllUsersWithSubscriptionsQuery,
): SubscriptionWithUser[] => {
  return result.users.map((user) => ({
    id: user.user_membership!.subscription!.id,
    organizationId: user.user_membership!.subscription!.organizationId,
    uploadLimit: user.user_membership!.subscription!.uploadLimit,
    downloadLimit: user.user_membership!.subscription!.downloadLimit,
    granularity: user.user_membership!.subscription!
      .granularity as SubscriptionGranularity,
    userPublicId: user.publicId,
    role: user.role,
    oauthProvider: user.oauthProvider,
    user: {
      publicId: user.publicId!,
      role: user.role as UserRole,
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      downloadCredits: 0,
      uploadCredits: 0,
      onboarded: true,
    },
  }));
};

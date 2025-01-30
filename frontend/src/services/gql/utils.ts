import {
  GetAllUsersWithSubscriptionsQuery,
  GetMetadataByHeadCidQuery,
} from '../../../gql/graphql';
import {
  SubscriptionGranularity,
  SubscriptionWithUser,
} from '../../models/Subscriptions';
import {
  OwnerRole,
  UploadedObjectMetadata,
} from '../../models/UploadedObjectMetadata';
import { UserRole } from '../../models/User';

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

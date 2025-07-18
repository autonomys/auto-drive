import { OffchainMetadata } from '@autonomys/auto-dag-data'
import {
  getObjectSummary,
  ObjectInformation,
  ObjectSearchResult,
  Owner,
  ObjectSummary,
  PaginatedResult,
  User,
  UserWithOrganization,
  objectStatus,
  isAdminUser,
  ObjectTag,
} from '@auto-drive/models'
import {
  metadataRepository,
  nodesRepository,
  ownershipRepository,
} from '../../repositories/index.js'
import { OwnershipUseCases } from './ownership.js'
import { UploadStatusUseCases } from './uploadStatus.js'
import { MetadataEntry } from '../../repositories/objects/metadata.js'
import { AuthManager } from '../../services/auth/index.js'
import { publishedObjectsRepository } from '../../repositories/objects/publishedObjects.js'
import { v4 } from 'uuid'
import { FilesUseCases } from './files.js'
import { downloadService } from '../../services/download/index.js'
import { createLogger } from '../../drivers/logger.js'
import { EventRouter } from '../../services/eventRouter/index.js'
import { createTask } from '../../services/eventRouter/tasks.js'
import { consumeStream } from '../../utils/misc.js'

const logger = createLogger('useCases:objects:object')

const getMetadata = async (cid: string) => {
  logger.debug('Fetching metadata for object (cid=%s)', cid)
  const entry = await metadataRepository.getMetadata(cid)
  if (!entry) {
    logger.info('No metadata found for object (cid=%s)', cid)
    return undefined
  }

  return entry.metadata
}

const saveMetadata = async (
  rootCid: string,
  cid: string,
  metadata: OffchainMetadata,
) => {
  logger.debug('Saving metadata (rootCid=%s, cid=%s)', rootCid, cid)
  return metadataRepository.setMetadata(rootCid, cid, metadata)
}

const searchMetadataByCID = async (
  cid: string,
  limit: number = 5,
  filter:
    | {
        scope: 'user'
        user: User
      }
    | {
        scope: 'global'
      },
): Promise<MetadataEntry[]> => {
  logger.debug(
    'Searching metadata by CID (cid=%s, limit=%d, scope=%s)',
    cid,
    limit,
    filter.scope,
  )
  if (filter.scope === 'user') {
    return metadataRepository.searchMetadataByCIDAndUser(
      cid,
      limit,
      filter.user.oauthProvider,
      filter.user.oauthUserId,
    )
  }

  return metadataRepository.searchMetadataByCID(cid, limit)
}

const searchMetadataByName = async (
  query: string,
  limit: number = 5,
  filter:
    | {
        scope: 'user'
        user: User
      }
    | {
        scope: 'global'
      },
): Promise<MetadataEntry[]> => {
  if (filter.scope === 'user') {
    return metadataRepository.searchMetadataByNameAndUser(
      query,
      filter.user.oauthProvider,
      filter.user.oauthUserId,
      limit,
    )
  }

  return metadataRepository.searchMetadataByName(query, limit)
}

const searchByCIDOrName = async (
  query: string,
  limit: number = 5,
  filter:
    | {
        scope: 'user'
        user: User
      }
    | {
        scope: 'global'
      },
): Promise<ObjectSearchResult[]> => {
  const names = await searchMetadataByName(query, limit, filter)
  if (names.length >= limit) {
    return names.slice(0, limit).map((e) => ({
      cid: e.head_cid,
      name: e.metadata.name!,
    }))
  }

  const cids = await searchMetadataByCID(query, limit - names.length, filter)
  return [...names, ...cids].slice(0, limit).map((e) => ({
    cid: e.head_cid,
    name: e.metadata.name!,
  }))
}

const getRootObjects = async (
  filter:
    | {
        scope: 'user'
        user: User
      }
    | {
        scope: 'global'
      },
  limit: number = 100,
  offset: number = 0,
): Promise<PaginatedResult<ObjectSummary>> => {
  if (filter.scope === 'user') {
    return metadataRepository
      .getRootObjectsByUser(
        filter.user.oauthProvider,
        filter.user.oauthUserId,
        limit,
        offset,
      )
      .then(async (entries) => ({
        rows: await Promise.all(
          entries.rows.map((entry) => getObjectSummaryByCID(entry)),
        ),
        totalCount: entries.totalCount,
      }))
  }

  return metadataRepository
    .getRootObjects(limit, offset)
    .then(async (entries) => ({
      rows: await Promise.all(
        entries.rows.map((entry) => getObjectSummaryByCID(entry)),
      ),
      totalCount: entries.totalCount,
    }))
}

const getSharedRoots = async (
  user: User,
  limit: number = 100,
  offset: number = 0,
): Promise<PaginatedResult<ObjectSummary>> => {
  return metadataRepository
    .getSharedRootObjectsByUser(
      user.oauthProvider,
      user.oauthUserId,
      limit,
      offset,
    )
    .then(async (entries) => {
      const summaries = await Promise.all(
        entries.rows.map((entry) => getObjectSummaryByCID(entry)),
      )

      return {
        rows: summaries,
        totalCount: entries.totalCount,
      }
    })
}

const getMarkedAsDeletedRoots = async (
  user: User,
  limit: number = 100,
  offset: number = 0,
): Promise<PaginatedResult<ObjectSummary>> => {
  return metadataRepository
    .getMarkedAsDeletedRootObjectsByUser(
      user.oauthProvider,
      user.oauthUserId,
      limit,
      offset,
    )
    .then(async (entries) => ({
      rows: await Promise.all(
        entries.rows.map((entry) => getObjectSummaryByCID(entry)),
      ),
      totalCount: entries.totalCount,
    }))
}

const getObjectSummaryByCID = async (cid: string) => {
  const info = await getObjectInformation(cid)
  if (!info) {
    throw new Error('Object not found')
  }

  return getObjectSummary(info)
}

const getObjectInformation = async (
  cid: string,
): Promise<ObjectInformation | undefined> => {
  const metadata = await metadataRepository.getMetadata(cid)
  if (!metadata) {
    return undefined
  }

  const uploadState = await UploadStatusUseCases.getUploadStatus(cid)
  const owners: Owner[] = await OwnershipUseCases.getOwners(cid)
  const publishedObjectId =
    await publishedObjectsRepository.getPublishedObjectByCid(cid)

  return {
    cid,
    metadata: metadata.metadata,
    tags: metadata.tags,
    uploadState: uploadState,
    owners,
    status: objectStatus(uploadState),
    publishedObjectId: publishedObjectId?.id ?? null,
    createdAt: metadata.created_at.toISOString(),
  }
}

const shareObject = async (executor: User, cid: string, publicId: string) => {
  logger.debug(
    'Attempting to share object (cid=%s) with user (publicId=%s)',
    cid,
    publicId,
  )
  const admins = await OwnershipUseCases.getAdmins(cid)
  const isUserAdmin = admins.find(
    (admin) =>
      admin.oauth_provider === executor.oauthProvider &&
      admin.oauth_user_id === executor.oauthUserId,
  )
  if (!isUserAdmin) {
    logger.warn(
      'User (%s) attempted to share object without admin rights (cid=%s)',
      executor.oauthUserId,
      cid,
    )
    throw new Error('User is not an admin of this object')
  }

  const user = await AuthManager.getUserFromPublicId(publicId)
  if (!user) {
    logger.warn(
      'Failed to share object - target user not found (publicId=%s)',
      publicId,
    )
    throw new Error('User not found')
  }

  if (user.publicId === null) {
    logger.warn(
      'Failed to share object - target user has no public ID (publicId=%s)',
      publicId,
    )
    throw new Error('User public ID is required')
  }

  await OwnershipUseCases.setUserAsOwner(user, cid)
  logger.info(
    'Object shared successfully (cid=%s, sharedWith=%s)',
    cid,
    publicId,
  )
}

const markAsDeleted = async (executor: User, cid: string) => {
  logger.debug('Attempting to mark object as deleted (cid=%s)', cid)
  const ownerships = await ownershipRepository.getOwnerships(cid)
  const isUserOwner = ownerships.find(
    (owner) =>
      owner.oauth_provider === executor.oauthProvider &&
      owner.oauth_user_id === executor.oauthUserId,
  )

  if (!isUserOwner) {
    logger.warn(
      'User (%s) attempted to delete object without ownership (cid=%s)',
      executor.oauthUserId,
      cid,
    )
    throw new Error('User is not an owner of this object')
  }

  await OwnershipUseCases.setObjectAsDeleted(executor, cid)
  logger.info('Object marked as deleted (cid=%s)', cid)
}

const restoreObject = async (executor: User, cid: string) => {
  logger.debug('Attempting to restore object (cid=%s)', cid)
  const deletedOwnerships = await ownershipRepository.getDeletedOwnerships(cid)
  const isUserOwner = deletedOwnerships.find(
    (owner) =>
      owner.oauth_provider === executor.oauthProvider &&
      owner.oauth_user_id === executor.oauthUserId,
  )

  if (!isUserOwner) {
    logger.warn(
      'User (%s) attempted to restore object without ownership (cid=%s)',
      executor.oauthUserId,
      cid,
    )
    throw new Error('User is not an owner of this object')
  }

  await OwnershipUseCases.restoreObject(executor, cid)
  logger.info('Object restored successfully (cid=%s)', cid)
}

const isArchived = async (cid: string) => {
  const metadata = await metadataRepository.getMetadata(cid)
  if (!metadata) {
    return false
  }

  return metadata.is_archived
}

const hasAllNodesArchived = async (cid: string) => {
  const nodes = await nodesRepository.getNodesByRootCid(cid)

  if (nodes.length === 0) {
    return false
  }

  return nodes.every((node) => node.piece_index !== null)
}

const getNonArchivedObjects = async () => {
  const objects = await metadataRepository.getMetadataByIsArchived(false)

  return objects.map((e) => e.head_cid)
}

const populateCaches = async (cid: string) => {
  try {
    const stream = await downloadService.download(cid)

    logger.debug('Downloaded object from DB after archival check (cid=%s)', cid)

    // Wait until the entire stream has been consumed (and therefore cached)
    await consumeStream(stream)
  } catch (e) {
    logger.warn(
      e as Error,
      'Failed to download object from DB after archival check (cid=%s)',
      cid,
    )
    throw e
  }
}

const onObjectArchived = async (cid: string) => {
  await ObjectUseCases.populateCaches(cid)
  await metadataRepository.markAsArchived(cid)
  await nodesRepository.removeNodeDataByRootCid(cid)
}

const publishObject = async (user: UserWithOrganization, cid: string) => {
  logger.debug('Attempting to publish object (cid=%s)', cid)
  const objects = await publishedObjectsRepository.getPublishedObjectById(cid)
  if (objects) {
    logger.debug('Object already published (cid=%s)', cid)
    return objects
  }
  if (!user.publicId) {
    logger.warn(
      'Failed to publish object - user has no public ID (userId=%s)',
      user.oauthUserId,
    )
    throw new Error('User public ID is required')
  }

  const publishedObject =
    await publishedObjectsRepository.createPublishedObject(
      v4(),
      user.publicId,
      cid,
    )
  logger.info('Object published successfully (cid=%s)', cid)

  return publishedObject
}

const downloadPublishedObject = async (id: string, blockingTags?: string[]) => {
  logger.debug('Attempting to download published object (id=%s)', id)
  const publishedObject =
    await publishedObjectsRepository.getPublishedObjectById(id)
  if (!publishedObject) {
    logger.warn('Published object not found (id=%s)', id)
    throw new Error('Published object not found')
  }

  const user = await AuthManager.getUserFromPublicId(publishedObject.publicId)
  if (!user) {
    logger.warn(
      'User not found or has no subscription (publicId=%s)',
      publishedObject.publicId,
    )
    throw new Error('User does not have a subscription')
  }

  logger.trace(
    'Starting download of published object (id=%s, cid=%s)',
    id,
    publishedObject.cid,
  )
  return FilesUseCases.downloadObjectByUser(
    user,
    publishedObject.cid,
    blockingTags,
  )
}

const unpublishObject = async (user: User, cid: string) => {
  logger.debug('Attempting to unpublish object (cid=%s)', cid)
  const publishedObject =
    await publishedObjectsRepository.getPublishedObjectByCid(cid)
  if (!publishedObject) {
    logger.debug('Object not published, nothing to unpublish (cid=%s)', cid)
    return
  }

  if (publishedObject.publicId !== user.publicId) {
    logger.warn(
      'User (%s) attempted to unpublish object without access (cid=%s)',
      user.publicId,
      cid,
    )
    throw new Error('User does not have access to this object')
  }

  await publishedObjectsRepository.deletePublishedObjectByCid(cid)
  logger.info('Object unpublished successfully (cid=%s)', cid)
}

const checkObjectsArchivalStatus = async () => {
  logger.debug('Starting archival status check for all objects')
  const cids = await getNonArchivedObjects()
  logger.trace('Found %d non-archived objects to check', cids.length)

  const results = await Promise.all(
    cids.map(async (cid) => {
      const allNodesArchived = await hasAllNodesArchived(cid)
      if (allNodesArchived) {
        logger.debug('Object ready for archival (cid=%s)', cid)
        return cid
      }
    }),
  ).then((e) => e.filter((e) => e !== undefined))

  const cidsToArchive = [...new Set(results)]
  logger.info('Found %d objects ready for archival', cidsToArchive.length)

  await Promise.all(
    cidsToArchive.map(async (cid) => {
      logger.debug('Publishing archival task for object (cid=%s)', cid)
      EventRouter.publish(
        createTask({
          id: 'object-archived',
          params: {
            cid,
          },
        }),
      )
    }),
  )
}

const addTag = async (cid: string, tag: string) => {
  await metadataRepository.addTag(cid, tag)
}

const banObject = async (executor: User, cid: string) => {
  logger.debug('Attempting to ban object (cid=%s)', cid)
  if (!isAdminUser(executor)) {
    logger.warn(
      'User (%s) attempted to ban object without admin rights (cid=%s)',
      executor.oauthUserId,
      cid,
    )
    throw new Error('User is not an admin')
  }

  await ObjectUseCases.addTag(cid, 'banned')

  logger.info('Object banned successfully (cid=%s)', cid)
}

const reportObject = async (executor: User, cid: string) => {
  logger.debug('Attempting to report object (cid=%s)', cid)
  await ObjectUseCases.addTag(cid, 'reported')

  logger.info('Object reported successfully (cid=%s)', cid)
}

const shouldBlockDownload = async (cid: string, blockingTags: string[]) => {
  const metadata = await metadataRepository.getMetadata(cid)
  if (!metadata) {
    return false
  }

  const actualBlockingsTags = [...blockingTags, ObjectTag.Banned]

  return metadata.tags.some((tag) => actualBlockingsTags.includes(tag))
}

const getReportingList = async (limit: number, offset: number) => {
  const metadata = await metadataRepository.getMetadataByTagIncludeExclude(
    ObjectTag.Reported,
    ObjectTag.Banned,
    limit,
    offset,
  )
  return metadata.rows.map((e) => e.head_cid)
}

export const ObjectUseCases = {
  getMetadata,
  getObjectInformation,
  saveMetadata,
  searchMetadataByCID,
  searchMetadataByName,
  searchByCIDOrName,
  getRootObjects,
  getSharedRoots,
  shareObject,
  getMarkedAsDeletedRoots,
  markAsDeleted,
  restoreObject,
  getObjectSummaryByCID,
  isArchived,
  hasAllNodesArchived,
  getNonArchivedObjects,
  onObjectArchived,
  publishObject,
  downloadPublishedObject,
  unpublishObject,
  checkObjectsArchivalStatus,
  populateCaches,
  addTag,
  banObject,
  reportObject,
  shouldBlockDownload,
  getReportingList,
}

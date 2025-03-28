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

const getMetadata = async (cid: string) => {
  const entry = await metadataRepository.getMetadata(cid)
  if (!entry) {
    return undefined
  }

  return entry.metadata
}

const saveMetadata = async (
  rootCid: string,
  cid: string,
  metadata: OffchainMetadata,
) => {
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

  const uploadStatus = await UploadStatusUseCases.getUploadStatus(cid)
  const owners: Owner[] = await OwnershipUseCases.getOwners(cid)
  const publishedObjectId =
    await publishedObjectsRepository.getPublishedObjectByCid(cid)

  return {
    cid,
    metadata: metadata.metadata,
    tags: metadata.tags,
    uploadStatus,
    owners,
    publishedObjectId: publishedObjectId?.id ?? null,
    createdAt: metadata.created_at.toISOString(),
  }
}

const shareObject = async (executor: User, cid: string, publicId: string) => {
  const admins = await OwnershipUseCases.getAdmins(cid)
  const isUserAdmin = admins.find(
    (admin) =>
      admin.oauth_provider === executor.oauthProvider &&
      admin.oauth_user_id === executor.oauthUserId,
  )
  if (!isUserAdmin) {
    throw new Error('User is not an admin of this object')
  }

  const user = await AuthManager.getUserFromPublicId(publicId)
  if (!user) {
    throw new Error('User not found')
  }

  if (user.publicId === null) {
    throw new Error('User public ID is required')
  }

  await OwnershipUseCases.setUserAsOwner(user, cid)
}

const markAsDeleted = async (executor: User, cid: string) => {
  const ownerships = await ownershipRepository.getOwnerships(cid)
  const isUserOwner = ownerships.find(
    (owner) =>
      owner.oauth_provider === executor.oauthProvider &&
      owner.oauth_user_id === executor.oauthUserId,
  )

  if (!isUserOwner) {
    throw new Error('User is not an owner of this object')
  }

  await OwnershipUseCases.setObjectAsDeleted(executor, cid)
}

const restoreObject = async (executor: User, cid: string) => {
  const deletedOwnerships = await ownershipRepository.getDeletedOwnerships(cid)
  const isUserOwner = deletedOwnerships.find(
    (owner) =>
      owner.oauth_provider === executor.oauthProvider &&
      owner.oauth_user_id === executor.oauthUserId,
  )

  if (!isUserOwner) {
    throw new Error('User is not an owner of this object')
  }

  await OwnershipUseCases.restoreObject(executor, cid)
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

const processArchival = async (cid: string) => {
  await metadataRepository.markAsArchived(cid)
  await nodesRepository.removeNodesByRootCid(cid)
}

const publishObject = async (user: UserWithOrganization, cid: string) => {
  const objects = await publishedObjectsRepository.getPublishedObjectById(cid)
  if (objects) {
    return objects
  }
  if (!user.publicId) {
    throw new Error('User public ID is required')
  }

  const publishedObject =
    await publishedObjectsRepository.createPublishedObject(
      v4(),
      user.publicId,
      cid,
    )

  return publishedObject
}

const downloadPublishedObject = async (id: string) => {
  const publishedObject =
    await publishedObjectsRepository.getPublishedObjectById(id)
  if (!publishedObject) {
    throw new Error('Published object not found')
  }

  const user = await AuthManager.getUserFromPublicId(publishedObject.publicId)
  if (!user) {
    throw new Error('User does not have a subscription')
  }

  return FilesUseCases.downloadObjectByUser(user, publishedObject.cid)
}

const unpublishObject = async (user: User, cid: string) => {
  const publishedObject =
    await publishedObjectsRepository.getPublishedObjectById(cid)
  if (!publishedObject) {
    return
  }

  if (publishedObject.publicId !== user.publicId) {
    throw new Error('User does not have access to this object')
  }

  await publishedObjectsRepository.deletePublishedObject(cid)
}

const checkObjectsArchivalStatus = async () => {
  const cids = await getNonArchivedObjects()

  for (const cid of cids) {
    const allNodesArchived = await hasAllNodesArchived(cid)
    // When archived, populate the cache with the file
    if (allNodesArchived) {
      await downloadService.download(cid)
      await processArchival(cid)
    }
  }
}

const addTag = async (cid: string, tag: string) => {
  await metadataRepository.addTag(cid, tag)
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
  processArchival,
  publishObject,
  downloadPublishedObject,
  unpublishObject,
  checkObjectsArchivalStatus,
  addTag,
}

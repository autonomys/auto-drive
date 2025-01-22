import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { User } from '../../models/users/index.js'
import {
  getObjectSummary,
  ObjectInformation,
  ObjectSearchResult,
  Owner,
  ObjectSummary,
} from '../../models/objects/object.js'
import {
  metadataRepository,
  nodesRepository,
  ownershipRepository,
} from '../../repositories/index.js'
import { OwnershipUseCases } from './ownership.js'
import { UploadStatusUseCases } from './uploadStatus.js'
import { MetadataEntry } from '../../repositories/objects/metadata.js'
import { PaginatedResult } from './common.js'
import { AuthManager } from '../../services/auth/index.js'

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
  const metadata = await getMetadata(cid)
  if (!metadata) {
    return undefined
  }

  const uploadStatus = await UploadStatusUseCases.getUploadStatus(cid)
  const owners: Owner[] = await OwnershipUseCases.getOwners(cid)

  return {
    cid,
    metadata,
    uploadStatus,
    owners,
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

const markAsArchived = async (cid: string) => {
  await metadataRepository.markAsArchived(cid)

  await nodesRepository.removeNodesByHeadCid(cid)
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
  markAsArchived,
}

import { User, Owner, OwnerRole } from '@auto-drive/models'
import { ownershipRepository } from '../../infrastructure/repositories/index.js'

const setUserAsOwner = async (user: User, cid: string) => {
  await ownershipRepository.setUserAsOwner(
    cid,
    user.oauthProvider,
    user.oauthUserId,
  )
}

const setUserAsAdmin = async (user: User, cid: string) => {
  await ownershipRepository.setUserAsAdmin(
    cid,
    user.oauthProvider,
    user.oauthUserId,
  )
}

const setObjectAsDeleted = async (user: User, cid: string) => {
  await ownershipRepository.updateDeletedAt(
    user.oauthProvider,
    user.oauthUserId,
    cid,
    new Date(),
  )
}

const restoreObject = async (user: User, cid: string) => {
  await ownershipRepository.updateDeletedAt(
    user.oauthProvider,
    user.oauthUserId,
    cid,
    null,
  )
}

const getOwners = async (cid: string): Promise<Owner[]> => {
  const ownerships = await ownershipRepository.getOwnerships(cid)

  return ownerships.map((ownership) => ({
    oauthProvider: ownership.oauth_provider,
    oauthUserId: ownership.oauth_user_id,
    role: ownership.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
  }))
}

const getAdmins = async (cid: string) => {
  return ownershipRepository.getAdmins(cid)
}

export const OwnershipUseCases = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
  getOwners,
  getAdmins,
  restoreObject,
}

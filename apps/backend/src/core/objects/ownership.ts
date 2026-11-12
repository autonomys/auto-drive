import { User, Owner, OwnerRole, isAdminUser } from '@auto-drive/models'
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

const toOwner = (ownership: {
  oauth_provider: string
  oauth_user_id: string
  is_admin: boolean
}): Owner => ({
  oauthProvider: ownership.oauth_provider,
  oauthUserId: ownership.oauth_user_id,
  role: ownership.is_admin ? OwnerRole.ADMIN : OwnerRole.VIEWER,
})

const getOwners = async (cid: string): Promise<Owner[]> => {
  const ownerships = await ownershipRepository.getOwnerships(cid)

  return ownerships.map(toOwner)
}

const getAdmins = async (cid: string) => {
  return ownershipRepository.getAdmins(cid)
}

// The same rule as the Hasura roles: admins see every active owner plus their
// own removed rows, other users see their own rows in any state, and anonymous
// viewers see none
const withVisibleOwners = async <T extends { owners: Owner[] }>(
  object: T,
  cid: string,
  viewer: User | null,
): Promise<T> => {
  if (!viewer) return { ...object, owners: [] }

  const ownerships = await ownershipRepository.getAllOwnerships(cid)
  const owners = ownerships
    .filter(
      (ownership) =>
        (ownership.oauth_provider === viewer.oauthProvider &&
          ownership.oauth_user_id === viewer.oauthUserId) ||
        (isAdminUser(viewer) && !ownership.marked_as_deleted),
    )
    .map(toOwner)

  return { ...object, owners }
}

export const OwnershipUseCases = {
  setUserAsOwner,
  setUserAsAdmin,
  setObjectAsDeleted,
  getOwners,
  getAdmins,
  restoreObject,
  withVisibleOwners,
}

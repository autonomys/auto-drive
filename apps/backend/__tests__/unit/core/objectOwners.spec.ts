import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { OwnerRole, User, UserRole } from '@auto-drive/models'
import { OwnershipUseCases } from '../../../src/core/objects/ownership.js'
import { ownershipRepository } from '../../../src/infrastructure/repositories/index.js'
import { createMockUser } from '../../utils/mocks.js'

describe('OwnershipUseCases.withVisibleOwners', () => {
  const owner = createMockUser()
  const sharee = createMockUser()
  const remover = createMockUser()
  const other = createMockUser()
  const admin = { ...createMockUser(), role: UserRole.Admin }

  const cid = 'bafkreiobject'
  const object = { cid, owners: [] }

  const row = (user: User, isAdmin: boolean, removed = false) => ({
    cid,
    oauth_provider: user.oauthProvider,
    oauth_user_id: user.oauthUserId,
    is_admin: isAdmin,
    marked_as_deleted: removed ? new Date() : null,
  })
  const asOwner = (user: User, role: OwnerRole) => ({
    oauthProvider: user.oauthProvider,
    oauthUserId: user.oauthUserId,
    role,
  })

  const getAllOwnerships = jest.spyOn(ownershipRepository, 'getAllOwnerships')

  beforeEach(() => {
    getAllOwnerships.mockResolvedValue([
      row(owner, true),
      row(sharee, false),
      row(remover, false, true),
      row(admin, false, true),
    ])
  })

  afterEach(() => {
    getAllOwnerships.mockReset()
  })

  const visibleTo = async (viewer: User | null) =>
    (await OwnershipUseCases.withVisibleOwners(object, cid, viewer)).owners

  it('returns no owners to anonymous viewers', async () => {
    expect(await visibleTo(null)).toEqual([])
    expect(getAllOwnerships).not.toHaveBeenCalled()
  })

  it('returns only their own rows to users, removed ones included', async () => {
    expect(await visibleTo(owner)).toEqual([asOwner(owner, OwnerRole.ADMIN)])
    expect(await visibleTo(sharee)).toEqual([asOwner(sharee, OwnerRole.VIEWER)])
    expect(await visibleTo(remover)).toEqual([
      asOwner(remover, OwnerRole.VIEWER),
    ])
    expect(await visibleTo(other)).toEqual([])
  })

  it('returns every active owner and their own removed rows to admins', async () => {
    expect(await visibleTo(admin)).toEqual([
      asOwner(owner, OwnerRole.ADMIN),
      asOwner(sharee, OwnerRole.VIEWER),
      asOwner(admin, OwnerRole.VIEWER),
    ])
  })
})

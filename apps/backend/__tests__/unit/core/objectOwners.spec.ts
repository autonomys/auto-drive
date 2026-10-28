import { describe, it, expect } from '@jest/globals'
import { Owner, OwnerRole, UserRole } from '@auto-drive/models'
import { OwnershipUseCases } from '../../../src/core/objects/ownership.js'
import { createMockUser } from '../../utils/mocks.js'

describe('OwnershipUseCases.withVisibleOwners', () => {
  const owner = createMockUser()
  const sharee = createMockUser()
  const other = createMockUser()

  const object = {
    cid: 'bafkreiobject',
    owners: [
      {
        oauthProvider: owner.oauthProvider,
        oauthUserId: owner.oauthUserId,
        role: OwnerRole.ADMIN,
      },
      {
        oauthProvider: sharee.oauthProvider,
        oauthUserId: sharee.oauthUserId,
        role: OwnerRole.VIEWER,
      },
    ] satisfies Owner[],
  }

  it('returns no owners to anonymous viewers', () => {
    expect(OwnershipUseCases.withVisibleOwners(object, null)).toEqual({
      cid: object.cid,
      owners: [],
    })
  })

  it('returns only their own rows to users', () => {
    expect(
      OwnershipUseCases.withVisibleOwners(object, owner).owners,
    ).toEqual([object.owners[0]])
    expect(
      OwnershipUseCases.withVisibleOwners(object, sharee).owners,
    ).toEqual([object.owners[1]])
    expect(OwnershipUseCases.withVisibleOwners(object, other).owners).toEqual(
      [],
    )
  })

  it('returns every owner to admins', () => {
    const admin = { ...other, role: UserRole.Admin }

    expect(OwnershipUseCases.withVisibleOwners(object, admin).owners).toEqual(
      object.owners,
    )
  })
})

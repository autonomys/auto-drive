import { jest } from '@jest/globals'
import { Request, Response } from 'express'
import { OrganizationRole, User } from '@auto-drive/models'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { OrganizationsUseCases, UsersUseCases } from '../src/useCases/index.js'
import { handleServiceAuth } from '../src/services/authManager/express.js'
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
} from '../src/errors/organizations.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createUnonboardedUser } from './utils/mocks.js'

const ACTOR = 'admin-public-id'

const onboard = async (): Promise<User> => {
  const user = await UsersUseCases.onboardUser(createUnonboardedUser())
  if (!user) throw new Error('Failed to onboard user')
  return user
}

const isArchived = async (organizationId: string): Promise<boolean> => {
  const [summary] = await OrganizationsUseCases.getOrganizationSummaries([
    organizationId,
  ])
  return summary.archivedAt !== null
}

describe('OrganizationsUseCases membership', () => {
  let partnerId: string

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })

  beforeEach(async () => {
    partnerId = (await OrganizationsUseCases.createOrganization('Partner')).id
  })

  it('moves a user in, archiving their personal organization', async () => {
    const user = await onboard()
    const personal = await OrganizationsUseCases.getOrganizationByUser(user)

    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: user.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })

    const current = await OrganizationsUseCases.getOrganizationByUser(user)
    expect(current.id).toBe(partnerId)
    expect(await isArchived(personal.id)).toBe(true)
    const partner = await OrganizationsUseCases.getOrganization(partnerId)
    expect(partner.members).toEqual([
      { publicId: user.publicId, role: OrganizationRole.Member },
    ])
    const [change] = await OrganizationsUseCases.getMembershipChanges(partnerId)
    expect(change).toMatchObject({
      publicId: user.publicId,
      fromOrganizationId: personal.id,
      toOrganizationId: partnerId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })
  })

  it('rolls the move back when it fails part way', async () => {
    const user = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: user.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })

    // Fails after the current membership is deleted inside the transaction.
    await expect(
      OrganizationsUseCases.addMember({
        organizationId: partnerId,
        publicId: user.publicId,
        role: OrganizationRole.Admin,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationConflictError)

    const partner = await OrganizationsUseCases.getOrganization(partnerId)
    expect(partner.members).toEqual([
      { publicId: user.publicId, role: OrganizationRole.Member },
    ])
    expect(
      await OrganizationsUseCases.getMembershipChanges(partnerId),
    ).toHaveLength(1)
  })

  it('rejects an unknown user, an invalid role and an archived organization', async () => {
    const user = await onboard()
    const personal = await OrganizationsUseCases.getOrganizationByUser(user)

    await expect(
      OrganizationsUseCases.addMember({
        organizationId: partnerId,
        publicId: 'no-such-user',
        role: OrganizationRole.Member,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
    await expect(
      OrganizationsUseCases.addMember({
        organizationId: partnerId,
        publicId: user.publicId,
        role: 'owner',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationValidationError)

    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: user.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })
    const other = await onboard()
    await expect(
      OrganizationsUseCases.addMember({
        organizationId: personal.id,
        publicId: other.publicId,
        role: OrganizationRole.Member,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationConflictError)
  })

  it('changes a member role and logs it', async () => {
    const user = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: user.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })

    await OrganizationsUseCases.changeMemberRole({
      organizationId: partnerId,
      publicId: user.publicId,
      role: OrganizationRole.Admin,
      actor: ACTOR,
    })

    const partner = await OrganizationsUseCases.getOrganization(partnerId)
    expect(partner.members[0].role).toBe(OrganizationRole.Admin)
    const [latest] = await OrganizationsUseCases.getMembershipChanges(partnerId)
    expect(latest).toMatchObject({
      fromOrganizationId: partnerId,
      toOrganizationId: partnerId,
      role: OrganizationRole.Admin,
    })

    const outsider = await onboard()
    await expect(
      OrganizationsUseCases.changeMemberRole({
        organizationId: partnerId,
        publicId: outsider.publicId,
        role: OrganizationRole.Admin,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
  })

  it('restores the personal organization on removal', async () => {
    const user = await onboard()
    const personal = await OrganizationsUseCases.getOrganizationByUser(user)
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: user.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })

    const { organizationId } = await OrganizationsUseCases.removeMember({
      organizationId: partnerId,
      publicId: user.publicId,
      actor: ACTOR,
    })

    expect(organizationId).toBe(personal.id)
    expect(await isArchived(personal.id)).toBe(false)
    const current = await OrganizationsUseCases.getOrganizationByUser(user)
    expect(current.id).toBe(personal.id)
    const restored = await OrganizationsUseCases.getOrganization(personal.id)
    expect(restored.members).toEqual([
      { publicId: user.publicId, role: OrganizationRole.Admin },
    ])
    const [change] = await OrganizationsUseCases.getMembershipChanges(partnerId)
    expect(change).toMatchObject({
      fromOrganizationId: partnerId,
      toOrganizationId: personal.id,
      actor: ACTOR,
    })

    await expect(
      OrganizationsUseCases.removeMember({
        organizationId: partnerId,
        publicId: user.publicId,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
  })

  it('creates a new personal organization when there is none to restore', async () => {
    const user = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: user.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })
    const db = await getDatabase()
    await db.query(
      'DELETE FROM users.organization_membership_changes WHERE to_organization_id = $1',
      [partnerId],
    )

    const { organizationId } = await OrganizationsUseCases.removeMember({
      organizationId: partnerId,
      publicId: user.publicId,
      actor: ACTOR,
    })

    const current = await OrganizationsUseCases.getOrganizationByUser(user)
    expect(current).toEqual({ id: organizationId, name: 'Personal' })
  })

  it('counts members per organization', async () => {
    const [first, second] = [await onboard(), await onboard()]
    for (const user of [first, second]) {
      await OrganizationsUseCases.addMember({
        organizationId: partnerId,
        publicId: user.publicId,
        role: OrganizationRole.Member,
        actor: ACTOR,
      })
    }

    const [summary] = await OrganizationsUseCases.getOrganizationSummaries([
      partnerId,
    ])

    expect(summary).toEqual({
      id: partnerId,
      name: 'Partner',
      archivedAt: null,
      memberCount: 2,
    })
  })
})

describe('handleServiceAuth', () => {
  const mockResponse = () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }
    return res as unknown as Response & typeof res
  }
  const requestWith = (authorization?: string) =>
    ({
      headers: { authorization, 'x-auth-provider': 'google' },
    }) as unknown as Request

  it('accepts the service secret', () => {
    const res = mockResponse()
    expect(handleServiceAuth(requestWith('Bearer test'), res)).toBe(true)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('rejects user tokens and missing tokens', () => {
    for (const authorization of ['Bearer some-user-token', undefined]) {
      const res = mockResponse()
      expect(handleServiceAuth(requestWith(authorization), res)).toBe(false)
      expect(res.status).toHaveBeenCalledWith(401)
    }
  })
})

import { jest } from '@jest/globals'
import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { Wallet } from 'ethers'
import {
  EndUserChange,
  OrganizationRole,
  User,
  UserRole,
  deriveUserPublicId,
} from '@auto-drive/models'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import {
  EndUserEnrollment,
  OrganizationsUseCases,
  UsersUseCases,
} from '../src/useCases/index.js'
import {
  organizationMembersRepository,
  organizationMembershipChangesRepository,
  usersRepository,
} from '../src/repositories/index.js'
import { organizationController } from '../src/controllers/organization.js'
import { config } from '../src/config.js'
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
} from '../src/errors/organizations.js'
import { DeletionUseCases } from '../src/useCases/deletion.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createUnonboardedUser } from './utils/mocks.js'

const ACTOR = 'org-admin-public-id'
const WALLET = 'web3-wallet'
const MAX_END_USERS = 100

const newAddress = () => Wallet.createRandom().address

// Every refusal over an address or reference looks the same.
const conflict = () =>
  new OrganizationConflictError(
    'An entry conflicts with an existing user or end user',
  )

const onboard = async (): Promise<User> => {
  const user = await UsersUseCases.onboardUser(createUnonboardedUser())
  if (!user) throw new Error('Failed to onboard user')
  return user
}

const endUser = (
  address: string,
  customerReference: string,
  uploadQuotaBytes: number | null = null,
): EndUserEnrollment => ({ address, customerReference, uploadQuotaBytes })

describe('End users', () => {
  let server: Server
  let baseUrl: string
  let partnerId: string

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    const app = express()
    app.use(express.json())
    app.use('/organizations', organizationController)
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await closeDatabase()
    await dbMigration.down()
  })

  beforeEach(async () => {
    partnerId = (await OrganizationsUseCases.createOrganization('Partner')).id
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const enroll = (
    endUsers: EndUserEnrollment[],
    { organizationId = partnerId, maxEndUsers = MAX_END_USERS } = {},
  ) =>
    OrganizationsUseCases.enrollEndUsers({
      organizationId,
      endUsers,
      maxEndUsers,
      actor: ACTOR,
    })
  const remove = (address: string, organizationId = partnerId) =>
    OrganizationsUseCases.removeEndUser({
      organizationId,
      address,
      actor: ACTOR,
    })
  const list = (limit = 100, offset = 0, organizationId = partnerId) =>
    OrganizationsUseCases.listEndUsers({ organizationId, limit, offset })
  const membershipOf = (address: string) =>
    organizationMembersRepository.getOrganizationMembershipByUser(
      WALLET,
      address,
    )
  // Every change recorded for the organisation, newest first. The membership
  // history leaves end users' out.
  const changes = async () => {
    const db = await getDatabase()
    const { rows } = await db.query(
      `SELECT * FROM users.organization_membership_changes
       WHERE from_organization_id = $1 OR to_organization_id = $1
       ORDER BY created_at DESC, id`,
      [partnerId],
    )
    return rows.map((row) => ({
      publicId: deriveUserPublicId(row.oauth_provider, row.oauth_user_id),
      fromOrganizationId: row.from_organization_id,
      toOrganizationId: row.to_organization_id,
      role: row.role,
      actor: row.actor,
      actorApiKeyId: row.actor_api_key_id,
    }))
  }

  it('creates an onboarded wallet user under the checksummed address', async () => {
    const address = newAddress()

    const [enrolled] = await enroll([
      endUser(address.toLowerCase(), 'customer-1', 1024),
    ])

    const publicId = deriveUserPublicId(WALLET, address)
    expect(enrolled).toEqual({
      address,
      publicId,
      customerReference: 'customer-1',
      uploadQuotaBytes: 1024,
      createdAt: expect.any(String),
      removedAt: null,
      closedAt: null,
    })
    const user = await usersRepository.getUserByOAuthInformation(
      WALLET,
      address,
    )
    expect(user).toMatchObject({
      public_id: publicId,
      role: UserRole.User,
    })
    // Wallet sign-in finds them by the checksummed address.
    const signedIn = await UsersUseCases.getUserByOAuthUser({
      provider: WALLET,
      id: address,
      username: address,
    })
    expect(signedIn).toMatchObject({ publicId, onboarded: true })
    expect(await membershipOf(address)).toMatchObject({
      organization_id: partnerId,
      role: OrganizationRole.PartnerEndUser,
      customer_reference: 'customer-1',
      upload_quota_bytes: '1024',
      end_user_removed_at: null,
    })
    expect(await changes()).toEqual([
      expect.objectContaining({
        publicId,
        fromOrganizationId: null,
        toOrganizationId: partnerId,
        role: OrganizationRole.PartnerEndUser,
        actor: ACTOR,
        endUserChange: null,
        uploadQuotaBytes: 1024,
      }),
    ])
  })

  it('returns active end users with the same reference and quota unchanged', async () => {
    const [first, second] = [newAddress(), newAddress()]
    const [enrolled] = await enroll([endUser(first, 'customer-1')])

    const again = await enroll([
      endUser(second, 'customer-2'),
      endUser(first.toLowerCase(), 'customer-1'),
    ])

    expect(again).toEqual([
      expect.objectContaining({
        address: second,
        customerReference: 'customer-2',
      }),
      enrolled,
    ])
    expect(await changes()).toHaveLength(2)
    // Another reference for the same person is refused.
    await expect(enroll([endUser(first, 'customer-9')])).rejects.toThrow(
      conflict(),
    )
  })

  it('refuses another quota for an active end user', async () => {
    const address = newAddress()
    const [enrolled] = await enroll([endUser(address, 'customer-1', 1024)])

    for (const quota of [2048, null]) {
      await expect(
        enroll([endUser(address, 'customer-1', quota)]),
      ).rejects.toThrow(conflict())
    }
    await expect(
      enroll([endUser(address, 'customer-1', 1024)]),
    ).resolves.toEqual([enrolled])
  })

  it('refuses an address that already has any other user', async () => {
    const selfSignedUp = newAddress()
    await UsersUseCases.onboardUser(
      (await UsersUseCases.getUserByOAuthUser({
        provider: WALLET,
        id: selfSignedUp,
      }))!,
    )
    const notOnboarded = newAddress()
    await usersRepository.createUser(
      WALLET,
      notOnboarded,
      undefined,
      undefined,
      null as unknown as string,
      UserRole.User,
    )
    const elsewhere = newAddress()
    const otherPartner = (
      await OrganizationsUseCases.createOrganization('Other')
    ).id
    await enroll([endUser(elsewhere, 'customer-1')], {
      organizationId: otherPartner,
    })
    const removedElsewhere = newAddress()
    await enroll([endUser(removedElsewhere, 'customer-2')], {
      organizationId: otherPartner,
    })
    await remove(removedElsewhere, otherPartner)
    const member = newAddress()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: (await UsersUseCases.onboardUser(
        (await UsersUseCases.getUserByOAuthUser({
          provider: WALLET,
          id: member,
        }))!,
      ))!.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })

    for (const address of [
      selfSignedUp,
      notOnboarded,
      elsewhere,
      removedElsewhere,
      member,
    ]) {
      await expect(enroll([endUser(address, 'c-1')])).rejects.toThrow(
        conflict(),
      )
    }

    // A batch whose last entry is sure to conflict enrolls nobody, and must
    // not tell whether an earlier entry had a user either.
    const own = newAddress()
    await enroll([endUser(own, 'own', 1024)])
    for (const probed of [selfSignedUp, newAddress()]) {
      await expect(
        enroll([endUser(probed, 'probe'), endUser(own, 'own', 2048)]),
      ).rejects.toThrow(conflict())
    }
  })

  it('refuses a customer reference another end user has, removed or not', async () => {
    const [active, removed, other] = [newAddress(), newAddress(), newAddress()]
    await enroll([
      endUser(active, 'customer-1'),
      endUser(removed, 'customer-2'),
    ])
    await remove(removed)

    for (const reference of ['customer-1', 'customer-2']) {
      await expect(enroll([endUser(other, reference)])).rejects.toThrow(
        conflict(),
      )
    }
    // Nor can a removed end user come back with another's reference.
    await expect(enroll([endUser(removed, 'customer-1')])).rejects.toThrow(
      conflict(),
    )
    // References are unique within an organisation only.
    const otherPartner = (
      await OrganizationsUseCases.createOrganization('Other')
    ).id
    await expect(
      enroll([endUser(other, 'customer-1')], { organizationId: otherPartner }),
    ).resolves.toHaveLength(1)
  })

  it('enrolls all of a batch or none of it', async () => {
    const [first, second, member] = [newAddress(), newAddress(), newAddress()]
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: (await UsersUseCases.onboardUser(
        (await UsersUseCases.getUserByOAuthUser({
          provider: WALLET,
          id: member,
        }))!,
      ))!.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })
    const changesBefore = await changes()

    // One address in the batch conflicts.
    await expect(
      enroll([endUser(first, 'customer-1'), endUser(member, 'customer-2')]),
    ).rejects.toBeInstanceOf(OrganizationConflictError)

    // Creating the second fails part way: another user has its public ID.
    await usersRepository.createUser(
      'google',
      'squatter',
      undefined,
      undefined,
      deriveUserPublicId(WALLET, second),
      UserRole.User,
    )
    await expect(
      enroll([endUser(first, 'customer-1'), endUser(second, 'customer-2')]),
    ).rejects.toThrow()

    expect(
      await usersRepository.getUserByOAuthInformation(WALLET, first),
    ).toBeUndefined()
    expect(await changes()).toEqual(changesBefore)
    expect((await list()).totalCount).toBe(0)
  })

  it('validates addresses, references and the organization', async () => {
    // From EIP-55, and with the case of its last letter changed.
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const badChecksum = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'

    for (const endUsers of [
      [endUser('not-an-address', 'c1')],
      [endUser(address.slice(2), 'c1')],
      [endUser(badChecksum, 'c1')],
      [endUser(address, 'c1'), endUser(address.toLowerCase(), 'c2')],
      [endUser(address, 'c1'), endUser(newAddress(), 'c1')],
    ]) {
      await expect(enroll(endUsers)).rejects.toBeInstanceOf(
        OrganizationValidationError,
      )
    }
    await expect(
      enroll([endUser(address, 'c1')], { organizationId: 'no-such-org' }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
    const db = await getDatabase()
    await db.query(
      'UPDATE users.organizations SET archived_at = NOW() WHERE id = $1',
      [partnerId],
    )
    await expect(enroll([endUser(address, 'c1')])).rejects.toBeInstanceOf(
      OrganizationConflictError,
    )
  })

  it('caps the end users that are not removed', async () => {
    const [first, second, third] = [newAddress(), newAddress(), newAddress()]
    const capped = (endUsers: EndUserEnrollment[]) =>
      enroll(endUsers, { maxEndUsers: 2 })
    await capped([endUser(first, 'c1'), endUser(second, 'c2')])

    await expect(capped([endUser(third, 'c3')])).rejects.toThrow(
      new OrganizationConflictError(
        'An organization can have at most 2 end users: it has 2, and this would add 1',
      ),
    )
    // Nothing new to enroll.
    await expect(capped([endUser(first, 'c1')])).resolves.toHaveLength(1)

    // A removed end user does not count.
    await remove(second)
    await expect(capped([endUser(third, 'c3')])).resolves.toHaveLength(1)
    // Enrolling them again would count.
    await expect(capped([endUser(second, 'c2')])).rejects.toThrow(
      new OrganizationConflictError(
        'An organization can have at most 2 end users: it has 2, and this would add 1',
      ),
    )
    expect((await list()).totalCount).toBe(3)
  })

  it('removes an end user, who stays in the organization read-only', async () => {
    const address = newAddress()
    const [enrolled] = await enroll([endUser(address, 'customer-1', 1024)])

    await remove(address.toLowerCase())

    expect(await membershipOf(address)).toMatchObject({
      organization_id: partnerId,
      role: OrganizationRole.PartnerEndUser,
      customer_reference: 'customer-1',
      end_user_removed_at: expect.any(Date),
    })
    const [removal] = await changes()
    expect(removal).toMatchObject({
      publicId: enrolled.publicId,
      fromOrganizationId: partnerId,
      toOrganizationId: null,
      role: OrganizationRole.PartnerEndUser,
      actor: ACTOR,
    })
    const {
      endUsers: [listed],
    } = await list()
    expect(listed).toEqual({ ...enrolled, removedAt: expect.any(String) })

    // Already removed: nothing changes.
    await remove(address)
    expect(await changes()).toHaveLength(2)
    expect((await list()).endUsers[0].removedAt).toBe(listed.removedAt)
  })

  it('removes only end users of the organization', async () => {
    const member = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: member.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })
    const walletMember = newAddress()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: (await UsersUseCases.onboardUser(
        (await UsersUseCases.getUserByOAuthUser({
          provider: WALLET,
          id: walletMember,
        }))!,
      ))!.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })
    const elsewhere = newAddress()
    const otherPartner = (
      await OrganizationsUseCases.createOrganization('Other')
    ).id
    await enroll([endUser(elsewhere, 'customer-1')], {
      organizationId: otherPartner,
    })

    for (const address of [walletMember, elsewhere, newAddress()]) {
      await expect(remove(address)).rejects.toThrow(
        new OrganizationNotFoundError('Not an end user of this organization'),
      )
    }
    await expect(remove('not-an-address')).rejects.toBeInstanceOf(
      OrganizationValidationError,
    )
    expect(await membershipOf(elsewhere)).toMatchObject({
      organization_id: otherPartner,
      end_user_removed_at: null,
    })
  })

  it('enrolls a removed end user again under the same reference only', async () => {
    const address = newAddress()
    const [enrolled] = await enroll([endUser(address, 'customer-1', 1024)])
    await remove(address)

    // A reference is permanent once given: another one would let the person
    // start again with a full quota, and free theirs for someone else.
    await expect(enroll([endUser(address, 'customer-2')])).rejects.toThrow(
      conflict(),
    )
    const [again] = await enroll([endUser(address, 'customer-1', 2048)])

    expect(again).toEqual({
      ...enrolled,
      uploadQuotaBytes: 2048,
      removedAt: null,
    })
    expect(await membershipOf(address)).toMatchObject({
      organization_id: partnerId,
      role: OrganizationRole.PartnerEndUser,
      customer_reference: 'customer-1',
      end_user_removed_at: null,
    })
    const [reenrolment] = await changes()
    expect(reenrolment).toMatchObject({
      publicId: enrolled.publicId,
      fromOrganizationId: null,
      toOrganizationId: partnerId,
      role: OrganizationRole.PartnerEndUser,
    })
    expect(await changes()).toHaveLength(3)
    // Its reference is still its own.
    await expect(enroll([endUser(newAddress(), 'customer-1')])).rejects.toThrow(
      conflict(),
    )
  })

  it('enrolls again after a conflict, and answers 503 while it keeps conflicting', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0)
    // What Aurora DSQL answers when another enrolment committed first. Here
    // it comes after the user was created, which the next run must not see.
    const conflict = () =>
      Object.assign(new Error('change conflicts with another transaction'), {
        code: '40001',
      })
    const recordChange = jest
      .spyOn(organizationMembershipChangesRepository, 'recordChange')
      .mockRejectedValueOnce(conflict())
    const address = newAddress()

    await expect(enroll([endUser(address, 'customer-1')])).resolves.toEqual([
      expect.objectContaining({ address, customerReference: 'customer-1' }),
    ])
    expect(recordChange).toHaveBeenCalledTimes(2)
    expect(await changes()).toHaveLength(1)

    recordChange.mockRejectedValue(conflict())
    const other = newAddress()
    const response = await fetch(
      `${baseUrl}/organizations/${partnerId}/end-users`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiSecret}`,
        },
        body: JSON.stringify({
          endUsers: [{ address: other, customerReference: 'customer-2' }],
          maxEndUsers: MAX_END_USERS,
          actor: ACTOR,
        }),
      },
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Too many concurrent changes, try again',
    })
    expect(recordChange).toHaveBeenCalledTimes(2 + 5)
    expect(
      await usersRepository.getUserByOAuthInformation(WALLET, other),
    ).toBeUndefined()
  })

  it('records the API key behind each change', async () => {
    const address = newAddress()
    await OrganizationsUseCases.enrollEndUsers({
      organizationId: partnerId,
      endUsers: [endUser(address, 'customer-1')],
      maxEndUsers: MAX_END_USERS,
      actor: ACTOR,
      actorApiKeyId: 'enrolling-key',
    })
    await OrganizationsUseCases.removeEndUser({
      organizationId: partnerId,
      address,
      actor: ACTOR,
      actorApiKeyId: 'removing-key',
    })
    // Signed in: no key.
    await enroll([endUser(address, 'customer-1')])

    expect(await changes()).toEqual([
      expect.objectContaining({ actor: ACTOR, actorApiKeyId: null }),
      expect.objectContaining({ actor: ACTOR, actorApiKeyId: 'removing-key' }),
      expect.objectContaining({ actor: ACTOR, actorApiKeyId: 'enrolling-key' }),
    ])
  })

  it('leaves end users out of the membership history', async () => {
    const address = newAddress()
    await enroll([endUser(address, 'customer-1')])
    await remove(address)
    await enroll([endUser(address, 'customer-1')])
    const member = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: member.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })

    expect(await OrganizationsUseCases.getMembershipChanges(partnerId)).toEqual(
      [
        expect.objectContaining({
          publicId: member.publicId,
          toOrganizationId: partnerId,
          role: OrganizationRole.Member,
        }),
      ],
    )
    // Still recorded.
    expect(await changes()).toHaveLength(4)
  })

  it('lists end users a page at a time, removed ones included', async () => {
    const addresses = Array.from({ length: 4 }, () => newAddress())
    // One per transaction, so each has its own enrollment time.
    for (const [i, address] of addresses.entries()) {
      await enroll([endUser(address, `c${i}`)])
    }
    await remove(addresses[1])

    const all = await list()
    expect(all.totalCount).toBe(4)
    expect(all.endUsers.map((e) => [e.address, e.removedAt !== null])).toEqual([
      [addresses[0], false],
      [addresses[1], true],
      [addresses[2], false],
      [addresses[3], false],
    ])
    const pages = [await list(3, 0), await list(3, 3), await list(3, 6)]
    expect(pages.map((p) => p.endUsers.map((e) => e.address))).toEqual([
      addresses.slice(0, 3),
      addresses.slice(3),
      [],
    ])
    expect(pages.map((p) => p.totalCount)).toEqual([4, 4, 4])
    await expect(list(100, 0, 'no-such-org')).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    )
  })

  it('leaves end users out of members, member counts and admin search', async () => {
    const member = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: member.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })
    const [active, removed] = [newAddress(), newAddress()]
    await enroll([endUser(active, 'c1'), endUser(removed, 'c2')])
    await remove(removed)

    const organization = await OrganizationsUseCases.getOrganization(partnerId)
    expect(organization.memberships).toEqual([
      { publicId: member.publicId, role: OrganizationRole.Member },
    ])
    expect(organization.members).toEqual([member.publicId])
    const [summary] = await OrganizationsUseCases.getOrganizationSummaries([
      partnerId,
    ])
    expect(summary.memberCount).toBe(1)
    const found = await UsersUseCases.adminSearchUsers('', partnerId)
    expect(found.map((u) => u.publicId)).toEqual([member.publicId])
    for (const address of [active, removed]) {
      expect(
        await UsersUseCases.adminSearchUsers(
          deriveUserPublicId(WALLET, address),
        ),
      ).toEqual([])
    }
  })

  it('neither gives the end user role nor moves, changes or removes end users', async () => {
    const user = await onboard()
    for (const action of [
      OrganizationsUseCases.addMember,
      OrganizationsUseCases.changeMemberRole,
    ]) {
      await expect(
        action({
          organizationId: partnerId,
          publicId: user.publicId,
          role: OrganizationRole.PartnerEndUser,
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(OrganizationValidationError)
    }

    const [active, removed] = [newAddress(), newAddress()]
    await enroll([endUser(active, 'c1'), endUser(removed, 'c2')])
    await remove(removed)
    const otherPartner = (
      await OrganizationsUseCases.createOrganization('Other')
    ).id
    for (const address of [active, removed]) {
      const publicId = deriveUserPublicId(WALLET, address)
      const before = await membershipOf(address)
      for (const [action, organizationId] of [
        [OrganizationsUseCases.addMember, otherPartner],
        [OrganizationsUseCases.changeMemberRole, partnerId],
        [OrganizationsUseCases.removeMember, partnerId],
      ] as const) {
        await expect(
          action({
            organizationId,
            publicId,
            role: OrganizationRole.Member,
            actor: ACTOR,
          }),
        ).rejects.toBeInstanceOf(OrganizationConflictError)
      }
      expect(await membershipOf(address)).toEqual(before)
    }
  })

  it('serves the end user routes only to the backend', async () => {
    const call = (
      method: string,
      path: string,
      body?: unknown,
      secret: string | undefined = config.apiSecret,
    ) =>
      fetch(`${baseUrl}/organizations/${partnerId}/end-users${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const address = newAddress()
    const valid = {
      endUsers: [{ address, customerReference: 'customer-1' }],
      maxEndUsers: 10,
      actor: ACTOR,
    }

    expect((await call('POST', '', valid, 'no')).status).toBe(401)
    for (const body of [
      { ...valid, actor: undefined },
      { ...valid, endUsers: [] },
      { ...valid, endUsers: [address] },
      { ...valid, endUsers: Array(101).fill(valid.endUsers[0]) },
      { ...valid, endUsers: [{ address }] },
      { ...valid, endUsers: [{ address, customerReference: '' }] },
      {
        ...valid,
        endUsers: [{ address, customerReference: 'c', uploadQuotaBytes: 0 }],
      },
      {
        ...valid,
        endUsers: [{ address, customerReference: 'c', uploadQuotaBytes: '1' }],
      },
      { ...valid, endUsers: [{ address: '0x1234', customerReference: 'c' }] },
      { ...valid, maxEndUsers: undefined },
      { ...valid, maxEndUsers: -1 },
      { ...valid, actorApiKeyId: 1 },
      { ...valid, actorApiKeyId: '' },
    ]) {
      expect([body, (await call('POST', '', body)).status]).toEqual([body, 400])
    }

    const enrolled = await call('POST', '', { ...valid, actorApiKeyId: 'key' })
    expect(enrolled.status).toBe(200)
    expect(await enrolled.json()).toEqual([
      {
        address,
        publicId: deriveUserPublicId(WALLET, address),
        customerReference: 'customer-1',
        uploadQuotaBytes: null,
        createdAt: expect.any(String),
        removedAt: null,
        closedAt: null,
      },
    ])

    expect((await call('GET', '', undefined, 'no')).status).toBe(401)
    for (const query of ['?limit=0', '?limit=501', '?offset=-1', '?limit=a']) {
      expect([query, (await call('GET', query)).status]).toEqual([query, 400])
    }
    const listed = await call('GET', '?limit=1&offset=0')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      endUsers: [expect.objectContaining({ address })],
      totalCount: 1,
    })

    expect((await call('DELETE', `/${address}`, {})).status).toBe(400)
    expect(
      (await call('DELETE', `/${address}`, { actor: ACTOR }, 'no')).status,
    ).toBe(401)
    expect((await call('DELETE', `/${address}`, { actor: ACTOR })).status).toBe(
      204,
    )
    // Removing them again is safe.
    expect((await call('DELETE', `/${address}`, { actor: ACTOR })).status).toBe(
      204,
    )
    expect(
      (await call('DELETE', `/${newAddress()}`, { actor: ACTOR })).status,
    ).toBe(404)
    expect(
      (await call('DELETE', '/not-an-address', { actor: ACTOR })).status,
    ).toBe(400)
  })

  describe('quotas and closed accounts', () => {
    const setQuota = (
      address: string,
      uploadQuotaBytes: number | null,
      actorApiKeyId: string | null = null,
    ) =>
      OrganizationsUseCases.setEndUserQuota({
        organizationId: partnerId,
        address,
        uploadQuotaBytes,
        actor: ACTOR,
        actorApiKeyId,
      })

    // Closes the user's account as the deletion job does once its grace
    // period is over.
    const closeAccount = async (address: string) => {
      const user = (await UsersUseCases.getUserByOAuthUser({
        provider: WALLET,
        id: address,
      })) as User
      const request = await DeletionUseCases.requestDeletion(user)
      await DeletionUseCases.markAsProcessing(request.id)
      await DeletionUseCases.anonymiseUser(request.id)
    }

    it('changes the quota of an active end user and records each change', async () => {
      const address = newAddress()
      await enroll([endUser(address, 'customer-1', 1024)])

      expect(await setQuota(address.toLowerCase(), 2048, 'key')).toEqual(
        expect.objectContaining({ address, uploadQuotaBytes: 2048 }),
      )
      // The same quota again changes nothing.
      await setQuota(address, 2048)
      expect(await setQuota(address, null)).toEqual(
        expect.objectContaining({ uploadQuotaBytes: null }),
      )

      expect(await membershipOf(address)).toMatchObject({
        upload_quota_bytes: null,
      })
      const quotaChange = {
        fromOrganizationId: partnerId,
        toOrganizationId: partnerId,
        role: OrganizationRole.PartnerEndUser,
        actor: ACTOR,
        endUserChange: EndUserChange.QuotaChanged,
      }
      expect(await changes()).toEqual([
        expect.objectContaining({
          ...quotaChange,
          uploadQuotaBytes: null,
          actorApiKeyId: null,
        }),
        expect.objectContaining({
          ...quotaChange,
          uploadQuotaBytes: 2048,
          actorApiKeyId: 'key',
        }),
        expect.objectContaining({
          toOrganizationId: partnerId,
          endUserChange: null,
          uploadQuotaBytes: 1024,
        }),
      ])
      // Enrolling again with the new quota is a retry.
      await expect(enroll([endUser(address, 'customer-1')])).resolves.toEqual([
        expect.objectContaining({ uploadQuotaBytes: null }),
      ])
    })

    it('changes the quota of active end users of the organization only', async () => {
      const removed = newAddress()
      await enroll([endUser(removed, 'customer-1')])
      await remove(removed)
      const elsewhere = newAddress()
      const other = (await OrganizationsUseCases.createOrganization('Other')).id
      await enroll([endUser(elsewhere, 'customer-2')], {
        organizationId: other,
      })

      for (const address of [removed, elsewhere, newAddress()]) {
        await expect(setQuota(address, 1)).rejects.toThrow(
          new OrganizationNotFoundError(
            'Not an active end user of this organization',
          ),
        )
      }
      await expect(setQuota('0x1234', 1)).rejects.toBeInstanceOf(
        OrganizationValidationError,
      )
      expect(await changes()).toHaveLength(2)
    })

    it('keeps the membership of a closed account so its reference stays reserved', async () => {
      const address = newAddress()
      const [enrolled] = await enroll([endUser(address, 'customer-1', 1024)])

      await closeAccount(address)

      const membership = await membershipOf(address)
      expect(membership).toMatchObject({
        organization_id: partnerId,
        role: OrganizationRole.PartnerEndUser,
        customer_reference: 'customer-1',
        end_user_removed_at: expect.any(Date),
        end_user_closed_at: expect.any(Date),
      })
      const { endUsers } = await list()
      expect(endUsers).toEqual([
        {
          ...enrolled,
          removedAt: expect.any(String),
          closedAt: expect.any(String),
        },
      ])
      const [closure] = await changes()
      expect(closure).toMatchObject({
        publicId: enrolled.publicId,
        fromOrganizationId: partnerId,
        toOrganizationId: null,
        role: OrganizationRole.PartnerEndUser,
        actor: enrolled.publicId,
        endUserChange: EndUserChange.AccountClosed,
      })
      // Nobody else gets the reference, and the cap doesn't count them.
      await expect(
        enroll([endUser(newAddress(), 'customer-1')]),
      ).rejects.toThrow(conflict())
      await expect(
        enroll([endUser(newAddress(), 'customer-2')], { maxEndUsers: 1 }),
      ).resolves.toHaveLength(1)

      // The partner can enroll them again, under the same reference.
      const [again] = await enroll([endUser(address, 'customer-1')])
      expect(again).toEqual({
        ...enrolled,
        uploadQuotaBytes: null,
        removedAt: null,
        closedAt: null,
      })
    })

    it('keeps when a removed end user was removed when they close their account', async () => {
      const address = newAddress()
      await enroll([endUser(address, 'customer-1')])
      await remove(address)
      const removedAt = (await membershipOf(address))?.end_user_removed_at

      await closeAccount(address)

      expect(await membershipOf(address)).toMatchObject({
        end_user_removed_at: removedAt,
        end_user_closed_at: expect.any(Date),
      })
    })

    it('still removes a member who closes their account from the organization', async () => {
      const user = await onboard()
      const request = await DeletionUseCases.requestDeletion(user)
      await DeletionUseCases.markAsProcessing(request.id)
      await DeletionUseCases.anonymiseUser(request.id)

      expect(
        await organizationMembersRepository.getOrganizationMembershipByUser(
          user.oauthProvider,
          user.oauthUserId,
        ),
      ).toBeFalsy()
    })

    it('serves the quota route only to the backend', async () => {
      const address = newAddress()
      await enroll([endUser(address, 'customer-1')])
      const patch = (
        body: unknown,
        target = address,
        secret = config.apiSecret,
      ) =>
        fetch(`${baseUrl}/organizations/${partnerId}/end-users/${target}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify(body),
        })
      const valid = { uploadQuotaBytes: 512, actor: ACTOR }

      expect((await patch(valid, address, 'no')).status).toBe(401)
      for (const body of [
        { actor: ACTOR },
        { ...valid, actor: undefined },
        { ...valid, uploadQuotaBytes: 0 },
        { ...valid, uploadQuotaBytes: 1.5 },
        { ...valid, uploadQuotaBytes: '512' },
        { ...valid, actorApiKeyId: 1 },
      ]) {
        expect([body, (await patch(body)).status]).toEqual([body, 400])
      }
      const changed = await patch({ ...valid, actorApiKeyId: 'key' })
      expect(changed.status).toBe(200)
      expect(await changed.json()).toEqual(
        expect.objectContaining({ address, uploadQuotaBytes: 512 }),
      )
      expect((await patch(valid, newAddress())).status).toBe(404)
      expect((await patch(valid, 'not-an-address')).status).toBe(400)
    })
  })
})

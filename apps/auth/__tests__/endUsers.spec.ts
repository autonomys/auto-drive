import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { Wallet } from 'ethers'
import {
  OrganizationRole,
  User,
  UserRole,
  deriveUserPublicId,
} from '@auto-drive/models'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { OrganizationsUseCases, UsersUseCases } from '../src/useCases/index.js'
import {
  organizationMembersRepository,
  usersRepository,
} from '../src/repositories/index.js'
import { organizationController } from '../src/controllers/organization.js'
import { config } from '../src/config.js'
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
} from '../src/errors/organizations.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createUnonboardedUser } from './utils/mocks.js'

const ACTOR = 'org-admin-public-id'
const WALLET = 'web3-wallet'

const newAddress = () => Wallet.createRandom().address

const onboard = async (): Promise<User> => {
  const user = await UsersUseCases.onboardUser(createUnonboardedUser())
  if (!user) throw new Error('Failed to onboard user')
  return user
}

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

  const enroll = (addresses: string[], organizationId = partnerId) =>
    OrganizationsUseCases.enrollEndUsers({
      organizationId,
      addresses,
      actor: ACTOR,
    })

  it('creates an onboarded wallet user under the checksummed address', async () => {
    const address = newAddress()

    const [enrolled] = await enroll([address.toLowerCase()])

    const publicId = deriveUserPublicId(WALLET, address)
    expect(enrolled).toEqual({ address, publicId })
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
    expect(
      await organizationMembersRepository.getOrganizationMembershipByUser(
        WALLET,
        address,
      ),
    ).toMatchObject({
      organization_id: partnerId,
      role: OrganizationRole.EndUser,
    })
    expect(await OrganizationsUseCases.getMembershipChanges(partnerId)).toEqual(
      [
        expect.objectContaining({
          publicId,
          fromOrganizationId: null,
          toOrganizationId: partnerId,
          role: OrganizationRole.EndUser,
          actor: ACTOR,
        }),
      ],
    )
  })

  it('returns end users already enrolled here unchanged', async () => {
    const [first, second] = [newAddress(), newAddress()]
    const enrolled = await enroll([first])

    const again = await enroll([second, first.toLowerCase()])

    expect(again).toEqual([
      { address: second, publicId: deriveUserPublicId(WALLET, second) },
      enrolled[0],
    ])
    expect(
      await OrganizationsUseCases.getMembershipChanges(partnerId),
    ).toHaveLength(2)
  })

  it('refuses an address that already has a user', async () => {
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
    await enroll([elsewhere], otherPartner)

    for (const address of [selfSignedUp, notOnboarded, elsewhere]) {
      await expect(enroll([address])).rejects.toThrow(
        new OrganizationConflictError(
          `${address} is already an Auto Drive user`,
        ),
      )
    }
  })

  it('enrolls all of a batch or none of it', async () => {
    const [first, second] = [newAddress(), newAddress()]
    // Takes the second address's public ID, so creating it fails part way.
    await usersRepository.createUser(
      'google',
      'squatter',
      undefined,
      undefined,
      deriveUserPublicId(WALLET, second),
      UserRole.User,
    )

    await expect(enroll([first, second])).rejects.toThrow()

    expect(
      await usersRepository.getUserByOAuthInformation(WALLET, first),
    ).toBeUndefined()
    expect(await OrganizationsUseCases.getMembershipChanges(partnerId)).toEqual(
      [],
    )
  })

  it('validates addresses and the organization', async () => {
    // From EIP-55, and with the case of its last letter changed.
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const badChecksum = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'

    for (const addresses of [
      ['not-an-address'],
      [address.slice(2)],
      [badChecksum],
      [address, address.toLowerCase()],
    ]) {
      await expect(enroll(addresses)).rejects.toBeInstanceOf(
        OrganizationValidationError,
      )
    }
    await expect(enroll([address], 'no-such-org')).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    )
    const db = await getDatabase()
    await db.query(
      'UPDATE users.organizations SET archived_at = NOW() WHERE id = $1',
      [partnerId],
    )
    await expect(enroll([address])).rejects.toBeInstanceOf(
      OrganizationConflictError,
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
    await enroll([newAddress(), newAddress()])

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
  })

  it('removes an end user into a new personal organization', async () => {
    const address = newAddress()
    const [{ publicId }] = await enroll([address])
    const member = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId: partnerId,
      publicId: member.publicId,
      role: OrganizationRole.Member,
      actor: ACTOR,
    })

    // Each route removes only its own kind of user.
    await expect(
      OrganizationsUseCases.removeMember({
        organizationId: partnerId,
        publicId,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationConflictError)
    await expect(
      OrganizationsUseCases.removeMember({
        organizationId: partnerId,
        publicId: member.publicId,
        actor: ACTOR,
        endUser: true,
      }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)

    const { organizationId } = await OrganizationsUseCases.removeMember({
      organizationId: partnerId,
      publicId,
      actor: ACTOR,
      endUser: true,
    })

    expect(organizationId).not.toBe(partnerId)
    const personal = await OrganizationsUseCases.getOrganization(organizationId)
    expect(personal).toMatchObject({
      name: 'Personal',
      memberships: [{ publicId, role: OrganizationRole.Admin }],
    })
    await expect(
      OrganizationsUseCases.removeMember({
        organizationId: partnerId,
        publicId,
        actor: ACTOR,
        endUser: true,
      }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
    // Now an Auto Drive user of their own, so not enrolled again.
    await expect(enroll([address])).rejects.toBeInstanceOf(
      OrganizationConflictError,
    )
  })

  it('neither gives the end user role nor moves or changes end users', async () => {
    const user = await onboard()
    for (const action of [
      OrganizationsUseCases.addMember,
      OrganizationsUseCases.changeMemberRole,
    ]) {
      await expect(
        action({
          organizationId: partnerId,
          publicId: user.publicId,
          role: OrganizationRole.EndUser,
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(OrganizationValidationError)
    }

    const [{ publicId }] = await enroll([newAddress()])
    const otherPartner = (
      await OrganizationsUseCases.createOrganization('Other')
    ).id
    for (const [action, organizationId] of [
      [OrganizationsUseCases.addMember, otherPartner],
      [OrganizationsUseCases.changeMemberRole, partnerId],
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
    expect(
      await organizationMembersRepository.getOrganizationMembershipByUser(
        WALLET,
        (await usersRepository.getUserByPublicId(publicId))!.oauth_user_id,
      ),
    ).toMatchObject({
      organization_id: partnerId,
      role: OrganizationRole.EndUser,
    })
  })

  it('serves the end user routes only to the backend', async () => {
    const call = (
      method: string,
      path: string,
      body: unknown,
      secret: string | undefined = config.apiSecret,
    ) =>
      fetch(`${baseUrl}/organizations/${partnerId}/end-users${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify(body),
      })
    const address = newAddress()

    expect(
      (await call('POST', '', { addresses: [address], actor: ACTOR }, 'no'))
        .status,
    ).toBe(401)
    for (const body of [
      { addresses: [address] },
      { addresses: [], actor: ACTOR },
      { addresses: [1], actor: ACTOR },
      { addresses: Array(101).fill(address), actor: ACTOR },
      { addresses: ['0x1234'], actor: ACTOR },
    ]) {
      expect((await call('POST', '', body)).status).toBe(400)
    }

    const enrolled = await call('POST', '', {
      addresses: [address],
      actor: ACTOR,
    })
    expect(enrolled.status).toBe(200)
    const [{ publicId }] = await enrolled.json()
    expect(publicId).toBe(deriveUserPublicId(WALLET, address))

    expect((await call('DELETE', `/${publicId}`, {})).status).toBe(400)
    expect(
      (await call('DELETE', `/${publicId}`, { actor: ACTOR }, 'no')).status,
    ).toBe(401)
    expect(
      (await call('DELETE', `/${publicId}`, { actor: ACTOR })).status,
    ).toBe(200)
    expect(
      (await call('DELETE', `/${publicId}`, { actor: ACTOR })).status,
    ).toBe(404)
  })
})

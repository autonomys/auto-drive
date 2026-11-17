import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { v4 } from 'uuid'
import {
  OrganizationRole,
  SERVICE_USER_PROVIDER,
  User,
  UserRole,
  deriveUserPublicId,
} from '@auto-drive/models'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import {
  ApiKeysUseCases,
  OrganizationsUseCases,
  UsersUseCases,
} from '../src/useCases/index.js'
import {
  organizationMembersRepository,
  organizationsRepository,
  usersRepository,
} from '../src/repositories/index.js'
import { userController } from '../src/controllers/user.js'
import { ApiKeyNotFoundError } from '../src/errors/apikeys.js'
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
} from '../src/errors/organizations.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createUnonboardedUser } from './utils/mocks.js'

const ACTOR = 'admin-public-id'
const NO_OPTIONS = { name: null, expiresAt: null }

const onboard = async (): Promise<User> => {
  const user = await UsersUseCases.onboardUser(createUnonboardedUser())
  if (!user) throw new Error('Failed to onboard user')
  return user
}

describe('Organization API keys', () => {
  let server: Server
  let baseUrl: string
  let organizationId: string

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()
    const app = express()
    app.use(express.json())
    app.use('/users', userController)
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
    organizationId = (await OrganizationsUseCases.createOrganization('Partner'))
      .id
  })

  // A request to auth made with the key, as the backend and clients make it.
  const withKey = (secret: string, method: string, path: string) =>
    fetch(`${baseUrl}/users${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        'x-auth-provider': 'apikey',
      },
    })

  it('gives a new partner organization a service user, not shown as a member', async () => {
    expect(
      await usersRepository.getUserByOAuthInformation(
        SERVICE_USER_PROVIDER,
        organizationId,
      ),
    ).toBeDefined()
    expect(
      await organizationMembersRepository.getOrganizationMembershipByUser(
        SERVICE_USER_PROVIDER,
        organizationId,
      ),
    ).toMatchObject({
      organization_id: organizationId,
      role: OrganizationRole.Member,
    })

    const organization =
      await OrganizationsUseCases.getOrganization(organizationId)
    expect(organization.memberships).toEqual([])
    const [summary] = await OrganizationsUseCases.getOrganizationSummaries([
      organizationId,
    ])
    expect(summary.memberCount).toBe(0)
  })

  it('resolves a key to the service user until it is revoked', async () => {
    const key = await OrganizationsUseCases.createApiKey(organizationId, {
      name: 'Production',
      expiresAt: null,
    })

    const me = await withKey(key.secret, 'GET', '/@me')
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({
      oauthProvider: SERVICE_USER_PROVIDER,
      oauthUserId: organizationId,
      organizationId,
      apiKeyId: key.id,
    })
    const [listed] = await OrganizationsUseCases.listApiKeys(organizationId)
    expect(listed).toMatchObject({ id: key.id, name: 'Production' })
    expect(listed).not.toHaveProperty('secret')

    await OrganizationsUseCases.revokeApiKey(organizationId, key.id)

    expect((await withKey(key.secret, 'GET', '/@me')).status).toBe(401)
    expect(await OrganizationsUseCases.listApiKeys(organizationId)).toEqual([])
  })

  it('keeps a key working after its creator is removed', async () => {
    const creator = await onboard()
    await OrganizationsUseCases.addMember({
      organizationId,
      publicId: creator.publicId,
      role: OrganizationRole.Admin,
      actor: ACTOR,
    })
    const key = await OrganizationsUseCases.createApiKey(
      organizationId,
      NO_OPTIONS,
    )

    await OrganizationsUseCases.removeMember({
      organizationId,
      publicId: creator.publicId,
      actor: ACTOR,
    })

    const me = await withKey(key.secret, 'GET', '/@me')
    expect(await me.json()).toMatchObject({
      oauthUserId: organizationId,
      organizationId,
    })
  })

  it('creates the service user of an older partner with its first key', async () => {
    const older = await organizationsRepository.createOrganization(
      v4(),
      'Older partner',
    )

    const key = await OrganizationsUseCases.createApiKey(older.id, NO_OPTIONS)
    await OrganizationsUseCases.createApiKey(older.id, NO_OPTIONS)

    expect(await OrganizationsUseCases.listApiKeys(older.id)).toHaveLength(2)
    const me = await withKey(key.secret, 'GET', '/@me')
    expect(await me.json()).toMatchObject({ organizationId: older.id })
    await expect(
      OrganizationsUseCases.createApiKey(v4(), NO_OPTIONS),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
  })

  it('revokes only keys of the organization', async () => {
    const otherId = (await OrganizationsUseCases.createOrganization('Other')).id
    const otherKey = await OrganizationsUseCases.createApiKey(
      otherId,
      NO_OPTIONS,
    )
    const personalKey = await ApiKeysUseCases.createApiKey(await onboard(), {})

    for (const id of [otherKey.id, personalKey.id, 'no-such-key']) {
      await expect(
        OrganizationsUseCases.revokeApiKey(organizationId, id),
      ).rejects.toBeInstanceOf(ApiKeyNotFoundError)
    }
    expect(await OrganizationsUseCases.listApiKeys(otherId)).toHaveLength(1)
  })

  it('keeps the service user in its organization with no role', async () => {
    const publicId = deriveUserPublicId(SERVICE_USER_PROVIDER, organizationId)
    const otherId = (await OrganizationsUseCases.createOrganization('Other')).id

    await expect(
      OrganizationsUseCases.addMember({
        organizationId: otherId,
        publicId,
        role: OrganizationRole.Member,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationConflictError)
    await expect(
      OrganizationsUseCases.changeMemberRole({
        organizationId,
        publicId,
        role: OrganizationRole.Admin,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationConflictError)
    await expect(
      OrganizationsUseCases.removeMember({
        organizationId,
        publicId,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(OrganizationConflictError)

    const admin = await onboard()
    await usersRepository.updateRole(
      admin.oauthProvider,
      admin.oauthUserId,
      UserRole.Admin,
    )
    await expect(
      UsersUseCases.updateRole(admin, publicId, UserRole.Admin),
    ).rejects.toThrow('A service user cannot be given a role')
  })

  it('lets a key only identify the service user in auth', async () => {
    const key = await OrganizationsUseCases.createApiKey(
      organizationId,
      NO_OPTIONS,
    )

    // No session, no key management and no deletion request.
    for (const [method, path] of [
      ['POST', '/@me/accessToken'],
      ['GET', '/@me/apiKeys'],
      ['POST', '/@me/apiKeys/create'],
      ['DELETE', `/@me/apiKeys/${key.id}`],
      ['POST', '/@me/deletion'],
    ]) {
      expect((await withKey(key.secret, method, path)).status).toBe(403)
    }
    expect(
      await OrganizationsUseCases.listApiKeys(organizationId),
    ).toHaveLength(1)

    // No sign-in provider yields a service user.
    const asService = await fetch(`${baseUrl}/users/@me`, {
      headers: {
        authorization: `Bearer ${key.secret}`,
        'x-auth-provider': SERVICE_USER_PROVIDER,
      },
    })
    expect(asService.status).toBe(401)
  })
})

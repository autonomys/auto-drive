import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { v4 } from 'uuid'
import {
  ApiKeyScope,
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
import { organizationController } from '../src/controllers/organization.js'
import { config } from '../src/config.js'
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

    // Two first keys at once both get created.
    const raced = await organizationsRepository.createOrganization(
      v4(),
      'Raced partner',
    )
    await Promise.all([
      OrganizationsUseCases.createApiKey(raced.id, NO_OPTIONS),
      OrganizationsUseCases.createApiKey(raced.id, NO_OPTIONS),
    ])
    expect(await OrganizationsUseCases.listApiKeys(raced.id)).toHaveLength(2)
  })

  it('creates no key in an archived organization', async () => {
    const archived = await organizationsRepository.createOrganization(
      v4(),
      'Archived',
    )
    const db = await getDatabase()
    await db.query(
      'UPDATE users.organizations SET archived_at = NOW() WHERE id = $1',
      [archived.id],
    )

    await expect(
      OrganizationsUseCases.createApiKey(archived.id, NO_OPTIONS),
    ).rejects.toBeInstanceOf(OrganizationConflictError)
    expect(
      await usersRepository.getUserByOAuthInformation(
        SERVICE_USER_PROVIDER,
        archived.id,
      ),
    ).toBeUndefined()
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
    ).rejects.toBeInstanceOf(OrganizationConflictError)
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

  it('gives no session for a personal key either', async () => {
    const user = await onboard()
    const key = await ApiKeysUseCases.createApiKey(user, NO_OPTIONS)

    expect((await withKey(key.secret, 'POST', '/@me/accessToken')).status).toBe(
      403,
    )
  })

  // Creates a key as the backend does.
  const createKey = (body: unknown) =>
    fetch(`${baseUrl}/organizations/${organizationId}/apiKeys`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiSecret}`,
      },
      body: JSON.stringify(body),
    })

  it('stores scopes sorted and returns them with the key and its user', async () => {
    const created = await createKey({
      name: 'Usage',
      scopes: [ApiKeyScope.Usage, ApiKeyScope.Files],
    })
    expect(created.status).toBe(201)
    const key = await created.json()
    const scopes = [ApiKeyScope.Files, ApiKeyScope.Usage]
    expect(key.scopes).toEqual(scopes)

    const db = await getDatabase()
    const { rows } = await db.query(
      'SELECT scopes FROM users.api_keys WHERE id = $1',
      [key.id],
    )
    expect(rows[0].scopes).toBe('files,usage')
    expect(await OrganizationsUseCases.listApiKeys(organizationId)).toEqual([
      expect.objectContaining({ id: key.id, scopes }),
    ])
    const me = await withKey(key.secret, 'GET', '/@me')
    expect(await me.json()).toMatchObject({
      apiKeyId: key.id,
      apiKeyScopes: scopes,
    })

    // Without scopes a key has full access, as every key had before them.
    const unscoped = await (await createKey({ name: 'All' })).json()
    expect(unscoped.scopes).toBeNull()
    const unscopedMe = await withKey(unscoped.secret, 'GET', '/@me')
    expect(await unscopedMe.json()).toMatchObject({
      apiKeyId: unscoped.id,
      apiKeyScopes: null,
    })
    expect((await (await createKey({ scopes: null })).json()).scopes).toBeNull()
  })

  it.each([
    ['an unknown scope', ['files', 'admin']],
    ['no scopes', []],
    ['a repeated scope', ['files', 'files']],
    ['a string', 'files'],
  ])('refuses a key with %s', async (_, scopes) => {
    const response = await createKey({ scopes })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('scopes')
    expect(await OrganizationsUseCases.listApiKeys(organizationId)).toEqual([])
  })

  it('gives a personal key no scopes', async () => {
    const user = await onboard()
    const key = await ApiKeysUseCases.createApiKey(user, NO_OPTIONS)
    expect(key.scopes).toBeNull()
    expect(
      await (await withKey(key.secret, 'GET', '/@me')).json(),
    ).toMatchObject({ apiKeyId: key.id, apiKeyScopes: null })

    for (const scopes of [[ApiKeyScope.Files], null]) {
      const response = await fetch(`${baseUrl}/users/@me/apiKeys/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key.secret}`,
          'x-auth-provider': 'apikey',
        },
        body: JSON.stringify({ name: 'Scoped', scopes }),
      })
      expect(response.status).toBe(400)
    }
    expect(await ApiKeysUseCases.getApiKeysByUser(user)).toHaveLength(1)
  })

  it('serves organization keys only to the backend', async () => {
    const call = (method: string, path: string, secret?: string) =>
      fetch(`${baseUrl}/organizations/${organizationId}/apiKeys${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        body:
          method === 'POST'
            ? JSON.stringify({ name: 'Production' })
            : undefined,
      })

    for (const [method, path] of [
      ['GET', ''],
      ['POST', ''],
      ['DELETE', '/any-key'],
    ]) {
      expect((await call(method, path)).status).toBe(401)
      expect((await call(method, path, 'not-the-secret')).status).toBe(401)
    }
    expect(await OrganizationsUseCases.listApiKeys(organizationId)).toEqual([])

    const created = await call('POST', '', config.apiSecret)
    expect(created.status).toBe(201)
    const { id } = await created.json()
    expect((await call('GET', '', config.apiSecret)).status).toBe(200)
    expect((await call('DELETE', `/${id}`, config.apiSecret)).status).toBe(204)
  })
})

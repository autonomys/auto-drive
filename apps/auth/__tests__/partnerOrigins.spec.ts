import express from 'express'
import { Server } from 'http'
import { AddressInfo } from 'net'
import { Wallet } from 'ethers'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import {
  OrganizationsUseCases,
  PartnerOriginsUseCases,
} from '../src/useCases/index.js'
import { organizationController } from '../src/controllers/organization.js'
import { config } from '../src/config.js'
import {
  OrganizationConflictError,
  OrganizationNotFoundError,
  OrganizationValidationError,
} from '../src/errors/organizations.js'
import { dbMigration } from './utils/dbMigrate.js'

const ACTOR = 'auto-drive-admin-public-id'

describe('Partner origins', () => {
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

  let originCount = 0
  const newOrigin = () => `https://app-${++originCount}.partner.example`

  const add = (origin: string, organizationId = partnerId) =>
    PartnerOriginsUseCases.addOrigin({ organizationId, origin, actor: ACTOR })
  const remove = (origin: string, organizationId = partnerId) =>
    PartnerOriginsUseCases.removeOrigin({ organizationId, origin })
  const enroll = (address: string) =>
    OrganizationsUseCases.enrollEndUsers({
      organizationId: partnerId,
      endUsers: [
        { address, customerReference: address, uploadQuotaBytes: null },
      ],
      maxEndUsers: 10,
      actor: ACTOR,
    })

  it('adds origins lower case, without a trailing slash', async () => {
    const origin = newOrigin()

    const added = await add(`${origin.toUpperCase()}/`)

    expect(added).toEqual({
      origin,
      organizationId: partnerId,
      createdBy: ACTOR,
      createdAt: expect.any(String),
    })
    const second = await add(`${newOrigin()}:8443`)
    expect(await PartnerOriginsUseCases.listOrigins(partnerId)).toEqual([
      added,
      second,
    ])
  })

  it('accepts https origins only', async () => {
    for (const origin of [
      'http://app.partner.example',
      'https://app.partner.example/path',
      'https://app.partner.example?query',
      'app.partner.example',
      '',
    ]) {
      await expect(add(origin)).rejects.toBeInstanceOf(
        OrganizationValidationError,
      )
    }
  })

  it('gives each origin to one organization', async () => {
    const origin = newOrigin()
    await add(origin)
    const other = (await OrganizationsUseCases.createOrganization('Other')).id

    await expect(add(origin)).rejects.toBeInstanceOf(OrganizationConflictError)
    await expect(add(origin, other)).rejects.toBeInstanceOf(
      OrganizationConflictError,
    )
    await expect(
      add(newOrigin(), 'no-such-organization'),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
  })

  it('refuses an origin of the global allowlist', async () => {
    // A partner origin takes precedence, so this would lock the explorer's
    // wallet users out.
    await expect(add(config.web3Auth.allowedOrigins[0])).rejects.toBeInstanceOf(
      OrganizationConflictError,
    )
  })

  it('refuses an archived organization', async () => {
    const db = await getDatabase()
    await db.query(
      'UPDATE users.organizations SET archived_at = NOW() WHERE id = $1',
      [partnerId],
    )

    await expect(add(newOrigin())).rejects.toBeInstanceOf(
      OrganizationConflictError,
    )
  })

  it('removes an origin only while the organization has no end users', async () => {
    const [kept, removable] = [newOrigin(), newOrigin()]
    await add(kept)
    await add(removable)

    await remove(removable)
    expect(await PartnerOriginsUseCases.listOrigins(partnerId)).toEqual([
      expect.objectContaining({ origin: kept }),
    ])

    const address = Wallet.createRandom().address
    await enroll(address)
    await expect(remove(kept)).rejects.toBeInstanceOf(OrganizationConflictError)
    // Removed end users sign in only through it too.
    await OrganizationsUseCases.removeEndUser({
      organizationId: partnerId,
      address,
      actor: ACTOR,
    })
    await expect(remove(kept)).rejects.toBeInstanceOf(OrganizationConflictError)
  })

  it('removes only the origins of the organization', async () => {
    const other = (await OrganizationsUseCases.createOrganization('Other')).id
    const origin = newOrigin()
    await add(origin, other)

    await expect(remove(origin)).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    )
    await expect(remove(newOrigin())).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    )
    expect(await PartnerOriginsUseCases.listOrigins(other)).toHaveLength(1)
  })

  it('serves the routes only to the backend', async () => {
    const call = (
      method: string,
      path: string,
      body?: unknown,
      secret: string | undefined = config.apiSecret,
    ) =>
      fetch(`${baseUrl}/organizations/${partnerId}/partner-origins${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const origin = newOrigin()

    expect(
      (await call('POST', '', { origin, actor: ACTOR }, 'no')).status,
    ).toBe(401)
    expect((await call('POST', '', { origin })).status).toBe(400)
    expect((await call('POST', '', { origin: 1, actor: ACTOR })).status).toBe(
      400,
    )
    const added = await call('POST', '', { origin, actor: ACTOR })
    expect(added.status).toBe(201)
    expect(await added.json()).toMatchObject({ origin, createdBy: ACTOR })
    expect((await call('POST', '', { origin, actor: ACTOR })).status).toBe(409)

    expect((await call('GET', '', undefined, 'no')).status).toBe(401)
    const listed = await call('GET', '')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual([expect.objectContaining({ origin })])

    const path = `?${new URLSearchParams({ origin })}`
    expect((await call('DELETE', path, undefined, 'no')).status).toBe(401)
    expect((await call('DELETE', '')).status).toBe(400)
    expect((await call('DELETE', `${path}&origin=${origin}`)).status).toBe(400)
    expect((await call('DELETE', path)).status).toBe(204)
    expect((await call('DELETE', path)).status).toBe(404)
  })
})

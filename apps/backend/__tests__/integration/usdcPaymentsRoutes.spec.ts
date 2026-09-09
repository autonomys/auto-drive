import { createServer } from 'net'
import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from '@jest/globals'
import { UserRole, type UserWithOrganization } from '@auto-drive/models'
import { config } from '../../src/config.js'
import { dbMigration } from '../utils/dbMigrate.js'
import { getDatabase } from '../../src/infrastructure/drivers/pg.js'
import { AuthManager } from '../../src/infrastructure/services/auth/index.js'
import { UsdcPaymentsUseCases } from '../../src/core/payments/usdc.js'
import { slackNotifier } from '../../src/infrastructure/services/slack/index.js'

// The three payment routes over real HTTP, against the real frontend API.
//
// Authorisation is already covered at the use-case level, and well. What is not
// covered anywhere else is the wiring: that handleAuth runs before the use case
// rather than beside it, that `changed` survives to the body, that the composite
// re-read cannot fail a flip that already happened, and — the claim this feature
// argues hardest for — that /payments is mounted OUTSIDE
// featureFlagMiddleware('buyCredits'), so the kill switch is reachable when
// buying is switched off. None of those can be tested by calling a use case.
describe('USDC payment routes (integration)', () => {
  const admin = {
    id: 'u-admin',
    publicId: 'admin-routes-1',
    oauthProvider: 'google',
    oauthUsername: 'admin@example.test',
    role: UserRole.Admin,
    organizationId: 'org-1',
  } as unknown as UserWithOrganization

  const buyer = {
    ...admin,
    id: 'u-buyer',
    publicId: 'buyer-routes-1',
    oauthUsername: 'buyer@example.test',
    role: UserRole.User,
  } as unknown as UserWithOrganization

  const RECEIVER = '0x1111111111111111111111111111111111111111'
  const ethereumDefaults = { ...config.ethereum }
  const usdcDefaults = { ...config.usdcPayments }
  const buyCredits = config.featureFlags.flags.buyCredits
  const flagDefaults = { ...buyCredits }
  const staffDomains = [...config.featureFlags.staffDomains]
  const allowlist = [...config.featureFlags.allowlistedUsernames]
  const portDefault = config.express.port

  let base: string

  // The API binds config.express.port at import. Another suite in the same run
  // may already hold the default, so a free one is claimed first — the port is
  // read at listen time, so setting it before the import is enough.
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = createServer()
      probe.once('error', reject)
      probe.listen(0, () => {
        const address = probe.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('no port'))
          return
        }
        probe.close(() => resolve(address.port))
      })
    })

  const as = (user: UserWithOrganization | null): Record<string, string> =>
    user
      ? {
          Authorization: `Bearer token-${user.publicId}`,
          'X-Auth-Provider': 'google',
        }
      : {}

  const get = (path: string, user: UserWithOrganization | null) =>
    fetch(`${base}${path}`, { headers: as(user) })

  const post = (path: string, user: UserWithOrganization | null) =>
    fetch(`${base}${path}`, { method: 'POST', headers: as(user) })

  beforeAll(async () => {
    await dbMigration.up()

    const port = await freePort()
    config.express.port = port
    base = `http://localhost:${port}`

    await import('../../src/app/apis/frontend.js')

    // The listener comes up asynchronously; poll rather than sleep.
    const deadline = Date.now() + 15_000
    for (;;) {
      try {
        const health = await fetch(`${base}/health`)
        if (health.status === 204) {
          break
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error('frontend API did not start')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })

  afterAll(async () => {
    config.express.port = portDefault
    Object.assign(config.ethereum, ethereumDefaults)
    Object.assign(config.usdcPayments, usdcDefaults)
    Object.assign(buyCredits, flagDefaults)
    config.featureFlags.staffDomains = staffDomains
    config.featureFlags.allowlistedUsernames = allowlist
    await dbMigration.down()
  })

  beforeEach(async () => {
    jest.restoreAllMocks()
    jest.spyOn(slackNotifier, 'send').mockResolvedValue(true)

    // Resolve whichever user the request presented, by the token it sent. Only
    // the two known tokens are exercised; a missing one never reaches here,
    // because handleAuth answers 401 before consulting the auth service.
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockImplementation(async (_provider, token) =>
        token === `token-${admin.publicId}` ? admin : buyer,
      )

    // No staff shortcut: the flag has to be genuinely off for the mounting test
    // below to mean anything.
    config.featureFlags.staffDomains = []
    config.featureFlags.allowlistedUsernames = []
    buyCredits.active = false
    buyCredits.staffOnly = false

    // A complete Ethereum configuration, so the composite gets past
    // NOT_CONFIGURED and reports the gate the routes are actually about.
    config.ethereum.rpcUrl = 'http://example.org'
    config.ethereum.usdcReceiverAddress = RECEIVER
    config.ethereum.usdcTokenAddress =
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    config.usdcPayments.treasuryAddresses = []
    config.usdcPayments.enabledByDefault = false

    const db = await getDatabase()
    await db.query('DELETE FROM usdc_gate_readings')
    await db.query('DELETE FROM usdc_payment_switch')
  })

  // ── authorisation, at the route rather than the use case ──────────────────

  it('refuses every route without credentials', async () => {
    expect((await get('/payments/usdc/status', null)).status).toBe(401)
    expect((await post('/payments/usdc/enable', null)).status).toBe(401)
    expect((await post('/payments/usdc/disable', null)).status).toBe(401)
  })

  it('refuses every route to a non-admin', async () => {
    expect((await get('/payments/usdc/status', buyer)).status).toBe(403)
    expect((await post('/payments/usdc/enable', buyer)).status).toBe(403)
    expect((await post('/payments/usdc/disable', buyer)).status).toBe(403)
  })

  it('leaves the gate untouched when a non-admin asks', async () => {
    // A 403 that had already written the row would be worse than no check.
    await post('/payments/usdc/enable', buyer)

    const gate = await UsdcPaymentsUseCases.getManualGate()
    expect(gate.enabled).toBe(false)
    expect(gate.source).toBe('env_default')
  })

  // ── the mounting this feature argues for ──────────────────────────────────

  it('serves the kill switch while buying is switched off', async () => {
    // /intents and /credits sit behind featureFlagMiddleware('buyCredits'),
    // which 404s the whole route when the flag is off. /payments deliberately
    // does not: hiding the kill switch behind the flag that gates buying would
    // make it unreachable in exactly the incident that needs it.
    expect((await post('/intents', admin)).status).toBe(404)

    expect((await get('/payments/usdc/status', admin)).status).toBe(200)
    expect((await post('/payments/usdc/disable', admin)).status).toBe(200)
  })

  // ── the flip, and what it reports ─────────────────────────────────────────

  it('reports the transition, then reports that there was none', async () => {
    const first = await post('/payments/usdc/enable', admin)
    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({
      enabled: true,
      changed: true,
    })

    // Idempotent, and `changed: false` is also what says no Slack alert was
    // posted — the distinction a dashboard needs to tell "you turned it on"
    // from "it was already on".
    const second = await post('/payments/usdc/enable', admin)
    await expect(second.json()).resolves.toMatchObject({
      enabled: true,
      changed: false,
    })

    const gate = await UsdcPaymentsUseCases.getManualGate()
    expect(gate.enabled).toBe(true)
    expect(gate.source).toBe('admin')
    expect(gate.updatedBy).toBe(admin.publicId)
  })

  it('answers with the composite after the flip, not with the switch', async () => {
    // Opening the switch does not open the path: nothing has polled, so the
    // balance is unknown and the composite still refuses. An admin who clicks
    // enable is owed that immediately rather than from the next refresh.
    const response = await post('/payments/usdc/enable', admin)
    const body = (await response.json()) as {
      availability: { open: boolean; closedReason?: string }
    }

    expect(body.availability.open).toBe(false)
    expect(body.availability.closedReason).toBe('balance_unknown')
  })

  it('keeps a flip honest when the composite re-read fails', async () => {
    // The re-read is a convenience and the flip has already been persisted and
    // already alerted. A throw here used to reach asyncSafeHandler as a 500, and
    // the admin card renders "Change failed — the gate is unchanged" on any
    // non-2xx — telling an admin the kill switch did not fire when it did.
    jest
      .spyOn(UsdcPaymentsUseCases, 'getAvailability')
      .mockRejectedValue(new Error('pool timeout'))

    const response = await post('/payments/usdc/disable', admin)

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.enabled).toBe(false)
    expect(body).not.toHaveProperty('availability')

    const gate = await UsdcPaymentsUseCases.getManualGate()
    expect(gate.enabled).toBe(false)
    expect(gate.source).toBe('admin')
  })

  // ── /features, the other half of the same wiring ──────────────────────────
  //
  // Three layers were changed for the USDC overlay and none of them had a
  // regression test: the asyncSafeHandler on featuresController, the `return
  // await` in getFeatureFlags, and the overlay's own fail-closed catch. The
  // third is covered well at the unit level; these cover the route.

  it('serves flags to an anonymous caller with USDC closed', async () => {
    const response = await get('/features', null)
    expect(response.status).toBe(200)

    const flags = (await response.json()) as Record<string, unknown>
    // Nothing has polled, so the composite refuses and the overlay says so
    // rather than advertising a path that would then 503.
    expect(flags.usdcAvailable).toBe(false)
    expect(flags.payWithUsdc).toBe(false)
  })

  it('serves flags to an authenticated caller', async () => {
    const response = await get('/features', admin)
    expect(response.status).toBe(200)

    const flags = (await response.json()) as Record<string, unknown>
    expect(flags).toHaveProperty('usdcAvailable')
    expect(flags).toHaveProperty('payWithUsdc')
  })

  it('still answers when the auth service throws', async () => {
    // /features is mounted on the DOWNLOAD API too. A rejection escaping here
    // would take downloads and S3 down with it over a flags read, so auth
    // failure falls back to unauthenticated flags rather than propagating.
    jest
      .spyOn(AuthManager, 'getUserFromAccessToken')
      .mockRejectedValue(new Error('auth service unreachable'))

    const response = await get('/features', admin)

    expect(response.status).toBe(200)
    const flags = (await response.json()) as Record<string, unknown>
    expect(flags.usdcAvailable).toBe(false)
  })

  it('still answers when the availability read throws', async () => {
    jest
      .spyOn(UsdcPaymentsUseCases, 'getAvailability')
      .mockRejectedValue(new Error('pool timeout'))

    const response = await get('/features', admin)

    expect(response.status).toBe(200)
    const flags = (await response.json()) as Record<string, unknown>
    expect(flags.usdcAvailable).toBe(false)
    expect(flags.payWithUsdc).toBe(false)
  })

  // ── the status page ───────────────────────────────────────────────────────

  it('serves every gate to an admin, in one answer', async () => {
    const response = await get('/payments/usdc/status', admin)
    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, unknown>
    expect(body).toHaveProperty('availability')
    expect(body).toHaveProperty('manualGate')
    expect(body).toHaveProperty('treasury')
    expect(body).toHaveProperty('oracle')
  })
})

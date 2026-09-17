import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  UsdcClosedReason,
  UserRole,
  type UserWithOrganization,
} from '@auto-drive/models'
import { withUsdcAvailability } from '../../../../src/core/featureFlags/express.js'
import { FeatureFlagsUseCases } from '../../../../src/core/featureFlags/index.js'
import { UsdcPaymentsUseCases } from '../../../../src/core/payments/usdc.js'
import { config } from '../../../../src/config.js'

// What /features tells a client about the USDC path.
//
// The invariant under test: what is advertised and what `createIntent` enforces
// come from the same function, so a client can never be shown a payment method
// the backend would refuse. Everything here is about that agreement — and about
// the endpoint surviving a database that cannot answer, since before this overlay
// existed it never touched one, and it is mounted on the download API as well as
// the frontend one.
describe('/features — USDC availability', () => {
  const ethereumDefaults = { ...config.ethereum }
  const usdcFlag = config.featureFlags.flags.payWithUsdc
  const usdcFlagDefault = usdcFlag.active

  // The flags a request would carry, computed by the real (sync, pure) flag
  // evaluator — so the audience half of every case below is the production rule
  // rather than a stand-in.
  const flagsFor = (role: UserRole | null) =>
    FeatureFlagsUseCases.get(
      role === null
        ? null
        : ({
            id: 'u1',
            publicId: role === UserRole.Admin ? 'admin-1' : 'user-1',
            oauthProvider: 'google',
            oauthUsername: 'someone@example.com',
            role,
            organizationId: 'org-1',
          } as unknown as UserWithOrganization),
    )

  const availability = (
    open: boolean,
    closedReason = UsdcClosedReason.TREASURY_CAP,
  ) =>
    jest
      .spyOn(UsdcPaymentsUseCases, 'getAvailability')
      .mockResolvedValue(
        open ? { open: true } : { open: false, closedReason },
      )

  beforeEach(() => {
    jest.clearAllMocks()
    config.ethereum.rpcUrl = 'http://example.org'
    config.ethereum.usdcReceiverAddress =
      '0x1111111111111111111111111111111111111111'
    config.ethereum.usdcTokenAddress =
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    usdcFlag.active = true
  })

  afterEach(() => {
    jest.restoreAllMocks()
    Object.assign(config.ethereum, ethereumDefaults)
    usdcFlag.active = usdcFlagDefault
  })

  it('advertises the path when the audience and the deployment both allow it', async () => {
    availability(true)

    const flags = await withUsdcAvailability(flagsFor(UserRole.User))

    expect(flags.payWithUsdc).toBe(true)
    expect(flags.usdcAvailable).toBe(true)
  })

  it('hides the path when a gate is closed, even for an allowed audience', async () => {
    availability(false)

    const flags = await withUsdcAvailability(flagsFor(UserRole.User))

    // The failure this prevents: offering a button whose POST /intents then
    // returns 503.
    expect(flags.payWithUsdc).toBe(false)
    expect(flags.usdcAvailable).toBe(false)
  })

  it('does not exempt an admin from the availability gates', async () => {
    // The audience flag exempts admins so the path can be driven in production.
    // These gates exempt nobody: a kill switch an admin walks through is not a
    // kill switch.
    usdcFlag.active = false
    availability(false, UsdcClosedReason.MANUAL_OFF)

    // The admin's audience check passes by exemption...
    const audience = flagsFor(UserRole.Admin)
    expect(audience.payWithUsdc).toBe(true)

    // ...and the availability gates still shut the path.
    const flags = await withUsdcAvailability(audience)

    expect(flags.payWithUsdc).toBe(false)
    expect(flags.usdcAvailable).toBe(false)
  })

  it('separates "not your audience" from "the deployment is not selling"', async () => {
    // One boolean cannot say both, and the difference is what an admin needs:
    // the path is open, they are simply not in the audience for it.
    usdcFlag.active = false
    availability(true)

    const flags = await withUsdcAvailability(flagsFor(UserRole.User))

    expect(flags.payWithUsdc).toBe(false)
    expect(flags.usdcAvailable).toBe(true)
  })

  it('still answers usdcAvailable for a caller outside the audience', async () => {
    // Deliberate: the two keys answer two questions, and short-circuiting the
    // read when the audience check fails would make `usdcAvailable` mean "you
    // may pay" all over again. A deployment with no USDC configuration still
    // reads nothing at all (next case), which is where the saving that matters
    // is.
    usdcFlag.active = false
    const spy = availability(true)

    const flags = await withUsdcAvailability(flagsFor(null))

    expect(flags.payWithUsdc).toBe(false)
    expect(flags.usdcAvailable).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reads nothing at all on a deployment with no USDC configuration', async () => {
    config.ethereum.usdcReceiverAddress = undefined
    const spy = availability(true)

    const flags = await withUsdcAvailability(flagsFor(UserRole.Admin))

    expect(flags.payWithUsdc).toBe(false)
    expect(flags.usdcAvailable).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('fails closed and does not throw when the gate cannot be read', async () => {
    // The defect this pins: the overlay added a database read to an endpoint
    // that previously could not touch one, its route has no async error boundary
    // in Express 4, and it is mounted on the DOWNLOAD API too — so a rejection
    // here (the migration not yet applied, a pool timeout) would crash-loop the
    // process and take downloads and S3 with it, over a payments read.
    jest
      .spyOn(UsdcPaymentsUseCases, 'getAvailability')
      .mockRejectedValue(new Error('relation "usdc_gate_readings" does not exist'))

    const flags = await withUsdcAvailability(flagsFor(UserRole.User))

    expect(flags.payWithUsdc).toBe(false)
    expect(flags.usdcAvailable).toBe(false)
    // And the rest of the map still answers: uploads must not go dark because
    // USDC could not be read.
    expect(flags.taskManager).toBeDefined()
  })

  it('reads the gate live on every call', async () => {
    const spy = availability(true)

    await withUsdcAvailability(flagsFor(UserRole.User))
    await withUsdcAvailability(flagsFor(UserRole.User))

    // Uncached deliberately: a kill switch whose effect waits out a TTL is not
    // the control an incident needs. Two indexed reads against two single-row
    // tables is not a cost worth a cache — the earlier attempt at one needed a
    // test-only reset hook and made every gate-flipping test reset it first.
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('picks up a flipped gate immediately', async () => {
    availability(true)
    expect(
      (await withUsdcAvailability(flagsFor(UserRole.User))).payWithUsdc,
    ).toBe(true)

    availability(false, UsdcClosedReason.MANUAL_OFF)

    expect(
      (await withUsdcAvailability(flagsFor(UserRole.User))).payWithUsdc,
    ).toBe(false)
  })

})

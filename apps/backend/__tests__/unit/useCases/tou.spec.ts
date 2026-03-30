import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { TouUseCases } from '../../../src/core/tou.js'
import { touRepository } from '../../../src/infrastructure/repositories/tou.js'
import { bannersRepository } from '../../../src/infrastructure/repositories/banners.js'
import {
  TouChangeType,
  TouVersion,
  TouVersionStatus,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from '../../../src/errors/index.js'
import { v4 as uuidv4 } from 'uuid'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeUser = (role: UserRole): UserWithOrganization => ({
  oauthProvider: 'google',
  oauthUserId: uuidv4(),
  role,
  onboarded: true,
  organizationId: uuidv4(),
  publicId: uuidv4(),
})

const makeVersion = (overrides: Partial<TouVersion> = {}): TouVersion => ({
  id: uuidv4(),
  versionLabel: 'v1.0',
  effectiveDate: new Date('2026-05-01'),
  contentUrl: 'https://example.com/tou',
  changeType: TouChangeType.Material,
  status: TouVersionStatus.Draft,
  adminNotes: null,
  createdBy: uuidv4(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

// ---------------------------------------------------------------------------
// Admin-only operations — non-admin user should receive ForbiddenError
// ---------------------------------------------------------------------------

describe('TouUseCases — admin-only endpoints return 403 for non-admin users', () => {
  const regularUser = makeUser(UserRole.User)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('getAllVersions: returns ForbiddenError for non-admin', async () => {
    const result = await TouUseCases.getAllVersions(regularUser)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('createTouVersion: returns ForbiddenError for non-admin', async () => {
    const result = await TouUseCases.createTouVersion(regularUser, {
      versionLabel: 'v1.0',
      effectiveDate: new Date(),
      contentUrl: 'https://example.com/tou',
      changeType: TouChangeType.Material,
      adminNotes: null,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('updateTouVersion: returns ForbiddenError for non-admin', async () => {
    const result = await TouUseCases.updateTouVersion(
      regularUser,
      uuidv4(),
      { versionLabel: 'v2.0' },
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('promoteToPending: returns ForbiddenError for non-admin', async () => {
    const result = await TouUseCases.promoteToPending(
      regularUser,
      uuidv4(),
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('activateVersion: returns ForbiddenError for non-admin', async () => {
    const result = await TouUseCases.activateVersion(regularUser, uuidv4())
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('archiveVersion: returns ForbiddenError for non-admin', async () => {
    const result = await TouUseCases.archiveVersion(regularUser, uuidv4())
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('getVersionWithStats: returns ForbiddenError for non-admin', async () => {
    const result = await TouUseCases.getVersionWithStats(
      regularUser,
      uuidv4(),
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('role check fires before any repository call', async () => {
    const spy = jest.spyOn(touRepository, 'getAllVersions')
    await TouUseCases.getAllVersions(regularUser)
    expect(spy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Admin operations — admin user should succeed (repo mocked)
// ---------------------------------------------------------------------------

describe('TouUseCases — admin user can perform admin operations', () => {
  const adminUser = makeUser(UserRole.Admin)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('getAllVersions: returns versions for admin', async () => {
    const versions = [makeVersion(), makeVersion()]
    jest
      .spyOn(touRepository, 'getAllVersions')
      .mockResolvedValue(versions)

    const result = await TouUseCases.getAllVersions(adminUser)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(versions)
  })

  it('createTouVersion: creates and returns a version', async () => {
    const version = makeVersion()
    jest
      .spyOn(touRepository, 'createVersion')
      .mockResolvedValue(version)

    const result = await TouUseCases.createTouVersion(adminUser, {
      versionLabel: 'v1.0',
      effectiveDate: new Date(),
      contentUrl: 'https://example.com/tou',
      changeType: TouChangeType.Material,
      adminNotes: null,
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(version)
  })

  it('updateTouVersion: only allows editing draft versions', async () => {
    const version = makeVersion({ status: TouVersionStatus.Active })
    jest
      .spyOn(touRepository, 'getVersionById')
      .mockResolvedValue(version)

    const result = await TouUseCases.updateTouVersion(adminUser, version.id, {
      versionLabel: 'v2.0',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('updateTouVersion: allows editing draft version', async () => {
    const version = makeVersion({ status: TouVersionStatus.Draft })
    const updated = makeVersion({ ...version, versionLabel: 'v2.0' })
    jest
      .spyOn(touRepository, 'getVersionById')
      .mockResolvedValue(version)
    jest
      .spyOn(touRepository, 'updateVersion')
      .mockResolvedValue(updated)

    const result = await TouUseCases.updateTouVersion(adminUser, version.id, {
      versionLabel: 'v2.0',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().versionLabel).toBe('v2.0')
  })

  it('updateTouVersion: returns NotFoundError for missing version', async () => {
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(null)

    const result = await TouUseCases.updateTouVersion(
      adminUser,
      uuidv4(),
      { versionLabel: 'v2.0' },
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// promoteToPending — notice period validation
// ---------------------------------------------------------------------------

describe('TouUseCases.promoteToPending', () => {
  const adminUser = makeUser(UserRole.Admin)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects non-draft versions', async () => {
    const version = makeVersion({ status: TouVersionStatus.Active })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)

    const result = await TouUseCases.promoteToPending(adminUser, version.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('rejects when another pending version exists', async () => {
    const version = makeVersion({ status: TouVersionStatus.Draft })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest
      .spyOn(touRepository, 'getPendingVersion')
      .mockResolvedValue(makeVersion({ status: TouVersionStatus.Pending }))

    const result = await TouUseCases.promoteToPending(adminUser, version.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(result._unsafeUnwrapErr().message).toContain('pending version already exists')
  })

  it('rejects material change with insufficient notice', async () => {
    const version = makeVersion({
      status: TouVersionStatus.Draft,
      changeType: TouChangeType.Material,
      effectiveDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)

    const result = await TouUseCases.promoteToPending(adminUser, version.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(result._unsafeUnwrapErr().message).toContain('30 days notice')
  })

  it('allows override with reason for insufficient notice', async () => {
    const version = makeVersion({
      status: TouVersionStatus.Draft,
      changeType: TouChangeType.Material,
      effectiveDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    })
    const promoted = makeVersion({
      ...version,
      status: TouVersionStatus.Pending,
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)
    jest.spyOn(touRepository, 'updateVersion').mockResolvedValue(version)
    jest
      .spyOn(touRepository, 'updateVersionStatus')
      .mockResolvedValue(promoted)
    jest
      .spyOn(bannersRepository, 'createBanner')
      .mockResolvedValue({} as never)

    const result = await TouUseCases.promoteToPending(
      adminUser,
      version.id,
      true,
      'Security emergency',
    )
    expect(result.isOk()).toBe(true)
  })

  it('rejects override without reason', async () => {
    const version = makeVersion({
      status: TouVersionStatus.Draft,
      changeType: TouChangeType.Material,
      effectiveDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)

    const result = await TouUseCases.promoteToPending(
      adminUser,
      version.id,
      true,
      '',
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(result._unsafeUnwrapErr().message).toContain('reason is required')
  })

  it('allows non-material change without 30-day notice', async () => {
    const version = makeVersion({
      status: TouVersionStatus.Draft,
      changeType: TouChangeType.NonMaterial,
      effectiveDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    })
    const promoted = makeVersion({
      ...version,
      status: TouVersionStatus.Pending,
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)
    jest
      .spyOn(touRepository, 'updateVersionStatus')
      .mockResolvedValue(promoted)

    const result = await TouUseCases.promoteToPending(adminUser, version.id)
    expect(result.isOk()).toBe(true)
  })

  it('creates banner for material change promotion', async () => {
    const version = makeVersion({
      status: TouVersionStatus.Draft,
      changeType: TouChangeType.Material,
      effectiveDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
    })
    const promoted = makeVersion({
      ...version,
      status: TouVersionStatus.Pending,
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)
    jest
      .spyOn(touRepository, 'updateVersionStatus')
      .mockResolvedValue(promoted)
    const bannerSpy = jest
      .spyOn(bannersRepository, 'createBanner')
      .mockResolvedValue({} as never)

    await TouUseCases.promoteToPending(adminUser, version.id)
    expect(bannerSpy).toHaveBeenCalledTimes(1)
  })

  it('does not create banner for non-material change promotion', async () => {
    const version = makeVersion({
      status: TouVersionStatus.Draft,
      changeType: TouChangeType.NonMaterial,
      effectiveDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
    })
    const promoted = makeVersion({
      ...version,
      status: TouVersionStatus.Pending,
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)
    jest
      .spyOn(touRepository, 'updateVersionStatus')
      .mockResolvedValue(promoted)
    const bannerSpy = jest
      .spyOn(bannersRepository, 'createBanner')
      .mockResolvedValue({} as never)

    await TouUseCases.promoteToPending(adminUser, version.id)
    expect(bannerSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// activateVersion
// ---------------------------------------------------------------------------

describe('TouUseCases.activateVersion', () => {
  const adminUser = makeUser(UserRole.Admin)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects non-pending versions', async () => {
    const version = makeVersion({ status: TouVersionStatus.Draft })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)

    const result = await TouUseCases.activateVersion(adminUser, version.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('archives current active version and activates pending', async () => {
    const pending = makeVersion({ status: TouVersionStatus.Pending })
    const currentActive = makeVersion({ status: TouVersionStatus.Active })
    const activated = makeVersion({
      ...pending,
      status: TouVersionStatus.Active,
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(pending)
    jest
      .spyOn(touRepository, 'getActiveVersion')
      .mockResolvedValue(currentActive)
    const statusSpy = jest
      .spyOn(touRepository, 'updateVersionStatus')
      .mockResolvedValueOnce(
        makeVersion({
          ...currentActive,
          status: TouVersionStatus.Archived,
        }),
      )
      .mockResolvedValueOnce(activated)

    const result = await TouUseCases.activateVersion(adminUser, pending.id)
    expect(result.isOk()).toBe(true)
    expect(statusSpy).toHaveBeenCalledTimes(2)
    expect(statusSpy).toHaveBeenCalledWith(
      currentActive.id,
      TouVersionStatus.Archived,
    )
    expect(statusSpy).toHaveBeenCalledWith(
      pending.id,
      TouVersionStatus.Active,
    )
  })
})

// ---------------------------------------------------------------------------
// archiveVersion
// ---------------------------------------------------------------------------

describe('TouUseCases.archiveVersion', () => {
  const adminUser = makeUser(UserRole.Admin)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects draft versions', async () => {
    const version = makeVersion({ status: TouVersionStatus.Draft })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)

    const result = await TouUseCases.archiveVersion(adminUser, version.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('archives pending version', async () => {
    const version = makeVersion({ status: TouVersionStatus.Pending })
    const archived = makeVersion({
      ...version,
      status: TouVersionStatus.Archived,
    })
    jest.spyOn(touRepository, 'getVersionById').mockResolvedValue(version)
    jest
      .spyOn(touRepository, 'updateVersionStatus')
      .mockResolvedValue(archived)

    const result = await TouUseCases.archiveVersion(adminUser, version.id)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe(TouVersionStatus.Archived)
  })
})

// ---------------------------------------------------------------------------
// getTouStatus — user-facing
// ---------------------------------------------------------------------------

describe('TouUseCases.getTouStatus', () => {
  const user = makeUser(UserRole.User)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns accepted=true when no active version exists', async () => {
    jest
      .spyOn(touRepository, 'ensureActiveVersion')
      .mockResolvedValue(null)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)

    const status = await TouUseCases.getTouStatus(user)
    expect(status.accepted).toBe(true)
    expect(status.currentVersion).toBeNull()
  })

  it('returns accepted=false when user has not accepted active version', async () => {
    const version = makeVersion({ status: TouVersionStatus.Active })
    jest
      .spyOn(touRepository, 'ensureActiveVersion')
      .mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)
    jest
      .spyOn(touRepository, 'hasUserAcceptedVersion')
      .mockResolvedValue(false)

    const status = await TouUseCases.getTouStatus(user)
    expect(status.accepted).toBe(false)
    expect(status.currentVersion).not.toBeNull()
    expect(status.currentVersion!.id).toBe(version.id)
  })

  it('returns accepted=true when user has accepted active version', async () => {
    const version = makeVersion({ status: TouVersionStatus.Active })
    jest
      .spyOn(touRepository, 'ensureActiveVersion')
      .mockResolvedValue(version)
    jest.spyOn(touRepository, 'getPendingVersion').mockResolvedValue(null)
    jest
      .spyOn(touRepository, 'hasUserAcceptedVersion')
      .mockResolvedValue(true)

    const status = await TouUseCases.getTouStatus(user)
    expect(status.accepted).toBe(true)
  })

  it('includes pending version info when one exists', async () => {
    const pending = makeVersion({
      status: TouVersionStatus.Pending,
      versionLabel: 'v2.0',
    })
    jest
      .spyOn(touRepository, 'ensureActiveVersion')
      .mockResolvedValue(null)
    jest
      .spyOn(touRepository, 'getPendingVersion')
      .mockResolvedValue(pending)

    const status = await TouUseCases.getTouStatus(user)
    expect(status.pendingVersion).not.toBeNull()
    expect(status.pendingVersion!.versionLabel).toBe('v2.0')
  })
})

// ---------------------------------------------------------------------------
// acceptCurrentVersion — user-facing
// ---------------------------------------------------------------------------

describe('TouUseCases.acceptCurrentVersion', () => {
  const user = makeUser(UserRole.User)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns NotFoundError when no active version exists', async () => {
    jest
      .spyOn(touRepository, 'ensureActiveVersion')
      .mockResolvedValue(null)

    const result = await TouUseCases.acceptCurrentVersion(user, '1.2.3.4')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('creates acceptance record for active version', async () => {
    const version = makeVersion({ status: TouVersionStatus.Active })
    jest
      .spyOn(touRepository, 'ensureActiveVersion')
      .mockResolvedValue(version)
    const createSpy = jest
      .spyOn(touRepository, 'createAcceptance')
      .mockResolvedValue({
        id: uuidv4(),
        userId: user.publicId,
        versionId: version.id,
        ipAddress: '1.2.3.4',
        acceptedAt: new Date(),
      })

    const result = await TouUseCases.acceptCurrentVersion(user, '1.2.3.4')
    expect(result.isOk()).toBe(true)
    expect(createSpy).toHaveBeenCalledWith(
      user.publicId,
      version.id,
      '1.2.3.4',
    )
  })
})

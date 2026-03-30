import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { BannersUseCases } from '../../../src/core/banners.js'
import { bannersRepository } from '../../../src/infrastructure/repositories/banners.js'
import {
  Banner,
  BannerCriticality,
  BannerInteractionType,
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

const makeBanner = (overrides: Partial<Banner> = {}): Banner => ({
  id: uuidv4(),
  title: 'Test banner',
  body: 'Body text',
  criticality: BannerCriticality.Info,
  dismissable: true,
  requiresAcknowledgement: false,
  displayStart: new Date(),
  displayEnd: null,
  active: true,
  createdBy: uuidv4(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const CREATE_PARAMS = {
  title: 'Test',
  body: 'Body',
  criticality: BannerCriticality.Info,
  dismissable: false,
  requiresAcknowledgement: false,
  displayStart: new Date(),
  displayEnd: null,
  active: true,
}

// ---------------------------------------------------------------------------
// Admin-only operations — non-admin user should receive ForbiddenError
// ---------------------------------------------------------------------------

describe('BannersUseCases — admin-only endpoints return 403 for non-admin users', () => {
  const regularUser = makeUser(UserRole.User)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('getAllBanners: returns ForbiddenError for non-admin', async () => {
    const result = await BannersUseCases.getAllBanners(regularUser)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('createBanner: returns ForbiddenError for non-admin', async () => {
    const result = await BannersUseCases.createBanner(regularUser, CREATE_PARAMS)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('updateBanner: returns ForbiddenError for non-admin', async () => {
    const result = await BannersUseCases.updateBanner(regularUser, uuidv4(), {
      title: 'New title',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('toggleBannerActive: returns ForbiddenError for non-admin', async () => {
    const result = await BannersUseCases.toggleBannerActive(
      regularUser,
      uuidv4(),
      false,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('getBannerWithStats: returns ForbiddenError for non-admin', async () => {
    const result = await BannersUseCases.getBannerWithStats(regularUser, uuidv4())
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('role check fires before any repository call', async () => {
    const spy = jest.spyOn(bannersRepository, 'getAllBanners')
    await BannersUseCases.getAllBanners(regularUser)
    expect(spy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Admin-only operations — admin user should succeed (repo mocked)
// ---------------------------------------------------------------------------

describe('BannersUseCases — admin user can perform admin operations', () => {
  const adminUser = makeUser(UserRole.Admin)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('getAllBanners: returns banners for admin', async () => {
    const banners = [makeBanner(), makeBanner()]
    jest
      .spyOn(bannersRepository, 'getAllBanners')
      .mockResolvedValue(banners)

    const result = await BannersUseCases.getAllBanners(adminUser)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(banners)
  })

  it('createBanner: creates and returns a banner for admin', async () => {
    const banner = makeBanner()
    jest
      .spyOn(bannersRepository, 'createBanner')
      .mockResolvedValue(banner)

    const result = await BannersUseCases.createBanner(adminUser, CREATE_PARAMS)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(banner)
  })

  it('updateBanner: updates and returns the banner for admin', async () => {
    const banner = makeBanner({ title: 'Updated' })
    jest
      .spyOn(bannersRepository, 'updateBanner')
      .mockResolvedValue(banner)

    const result = await BannersUseCases.updateBanner(adminUser, banner.id, {
      title: 'Updated',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().title).toBe('Updated')
  })

  it('getBannerWithStats: returns stats for admin', async () => {
    const stats = { ...makeBanner(), acknowledgementCount: 3, dismissalCount: 1 }
    jest
      .spyOn(bannersRepository, 'getBannerWithStats')
      .mockResolvedValue(stats)

    const result = await BannersUseCases.getBannerWithStats(adminUser, stats.id)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().acknowledgementCount).toBe(3)
  })

  it('getBannerWithStats: returns NotFoundError when banner does not exist', async () => {
    jest
      .spyOn(bannersRepository, 'getBannerWithStats')
      .mockResolvedValue(null)

    const result = await BannersUseCases.getBannerWithStats(adminUser, uuidv4())
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// recordInteraction — user-facing, no admin requirement
// ---------------------------------------------------------------------------

describe('BannersUseCases.recordInteraction', () => {
  const user = makeUser(UserRole.User)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns NotFoundError when banner does not exist', async () => {
    jest.spyOn(bannersRepository, 'getBannerById').mockResolvedValue(null)

    const result = await BannersUseCases.recordInteraction(
      user,
      uuidv4(),
      BannerInteractionType.Dismissed,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('returns BadRequestError when dismissing a non-dismissable banner', async () => {
    const banner = makeBanner({ dismissable: false })
    jest
      .spyOn(bannersRepository, 'getBannerById')
      .mockResolvedValue(banner)

    const result = await BannersUseCases.recordInteraction(
      user,
      banner.id,
      BannerInteractionType.Dismissed,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('returns BadRequestError when acknowledging a non-acknowledgeable banner', async () => {
    const banner = makeBanner({ requiresAcknowledgement: false })
    jest
      .spyOn(bannersRepository, 'getBannerById')
      .mockResolvedValue(banner)

    const result = await BannersUseCases.recordInteraction(
      user,
      banner.id,
      BannerInteractionType.Acknowledged,
    )
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('succeeds for a dismissable banner', async () => {
    const banner = makeBanner({ dismissable: true })
    jest
      .spyOn(bannersRepository, 'getBannerById')
      .mockResolvedValue(banner)
    jest
      .spyOn(bannersRepository, 'createInteraction')
      .mockResolvedValue(null)

    const result = await BannersUseCases.recordInteraction(
      user,
      banner.id,
      BannerInteractionType.Dismissed,
    )
    expect(result.isOk()).toBe(true)
  })

  it('succeeds for a banner requiring acknowledgement', async () => {
    const banner = makeBanner({ requiresAcknowledgement: true })
    jest
      .spyOn(bannersRepository, 'getBannerById')
      .mockResolvedValue(banner)
    jest
      .spyOn(bannersRepository, 'createInteraction')
      .mockResolvedValue(null)

    const result = await BannersUseCases.recordInteraction(
      user,
      banner.id,
      BannerInteractionType.Acknowledged,
    )
    expect(result.isOk()).toBe(true)
  })
})

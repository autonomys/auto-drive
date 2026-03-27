import {
  Banner,
  BannerCriticality,
  BannerInteractionType,
  BannerWithStats,
  User,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { bannersRepository } from '../infrastructure/repositories/banners.js'
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../errors/index.js'
import { err, ok, Result } from 'neverthrow'
import { createLogger } from '../infrastructure/drivers/logger.js'

const logger = createLogger('BannersUseCases')

// ---------------------------------------------------------------------------
// getActiveBannersForUser
// ---------------------------------------------------------------------------

const getActiveBannersForUser = async (
  user: UserWithOrganization,
): Promise<Banner[]> => {
  return bannersRepository.getActiveBannersForUser(user.publicId)
}

// ---------------------------------------------------------------------------
// recordInteraction
// ---------------------------------------------------------------------------

const recordInteraction = async (
  user: UserWithOrganization,
  bannerId: string,
  type: BannerInteractionType,
): Promise<Result<void, NotFoundError | BadRequestError>> => {
  const banner = await bannersRepository.getBannerById(bannerId)
  if (!banner) {
    return err(new NotFoundError('Banner not found'))
  }

  if (type === BannerInteractionType.Dismissed && !banner.dismissable) {
    return err(new BadRequestError('Banner is not dismissable'))
  }

  if (
    type === BannerInteractionType.Acknowledged &&
    !banner.requiresAcknowledgement
  ) {
    return err(
      new BadRequestError('Banner does not require acknowledgement'),
    )
  }

  await bannersRepository.createInteraction(user.publicId, bannerId, type)
  return ok(undefined)
}

// ---------------------------------------------------------------------------
// Admin: createBanner
// ---------------------------------------------------------------------------

type CreateBannerParams = {
  title: string
  body: string
  criticality: BannerCriticality
  dismissable: boolean
  requiresAcknowledgement: boolean
  displayStart: Date
  displayEnd: Date | null
  active: boolean
}

const createBanner = async (
  executor: User,
  params: CreateBannerParams,
): Promise<Result<Banner, ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    logger.warn('Non-admin user attempted to create banner', {
      publicId: executor.publicId,
    })
    return err(new ForbiddenError('Admin access required'))
  }

  const banner = await bannersRepository.createBanner({
    ...params,
    createdBy: executor.publicId,
  })
  return ok(banner)
}

// ---------------------------------------------------------------------------
// Admin: updateBanner
// ---------------------------------------------------------------------------

type UpdateBannerParams = {
  title?: string
  body?: string
  criticality?: BannerCriticality
  dismissable?: boolean
  requiresAcknowledgement?: boolean
  displayStart?: Date
  displayEnd?: Date | null
  active?: boolean
}

const updateBanner = async (
  executor: User,
  bannerId: string,
  params: UpdateBannerParams,
): Promise<Result<Banner, ForbiddenError | NotFoundError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const banner = await bannersRepository.updateBanner(bannerId, params)
  if (!banner) {
    return err(new NotFoundError('Banner not found'))
  }

  return ok(banner)
}

// ---------------------------------------------------------------------------
// Admin: toggleBannerActive
// ---------------------------------------------------------------------------

const toggleBannerActive = async (
  executor: User,
  bannerId: string,
  active: boolean,
): Promise<Result<Banner, ForbiddenError | NotFoundError>> => {
  return updateBanner(executor, bannerId, { active })
}

// ---------------------------------------------------------------------------
// Admin: getAllBanners
// ---------------------------------------------------------------------------

const getAllBanners = async (
  executor: User,
): Promise<Result<Banner[], ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const banners = await bannersRepository.getAllBanners()
  return ok(banners)
}

// ---------------------------------------------------------------------------
// Admin: getBannerWithStats
// ---------------------------------------------------------------------------

const getBannerWithStats = async (
  executor: User,
  bannerId: string,
): Promise<Result<BannerWithStats, ForbiddenError | NotFoundError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const banner = await bannersRepository.getBannerWithStats(bannerId)
  if (!banner) {
    return err(new NotFoundError('Banner not found'))
  }

  return ok(banner)
}

export const BannersUseCases = {
  getActiveBannersForUser,
  recordInteraction,
  createBanner,
  updateBanner,
  toggleBannerActive,
  getAllBanners,
  getBannerWithStats,
}

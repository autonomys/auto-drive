import {
  TouAcceptance,
  TouChangeType,
  TouStatus,
  TouVersion,
  TouVersionStatus,
  TouVersionWithStats,
  User,
  UserRole,
  UserWithOrganization,
  BannerCriticality,
} from '@auto-drive/models'
import { touRepository } from '../infrastructure/repositories/tou.js'
import { bannersRepository } from '../infrastructure/repositories/banners.js'
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../errors/index.js'
import { err, ok, Result } from 'neverthrow'
import { createLogger } from '../infrastructure/drivers/logger.js'

const logger = createLogger('TouUseCases')

const NOTICE_DAYS = 30

// ---------------------------------------------------------------------------
// getTouStatus — user-facing
// ---------------------------------------------------------------------------

const getTouStatus = async (
  user: UserWithOrganization,
): Promise<TouStatus> => {
  const activeVersion = await touRepository.ensureActiveVersion()
  const pendingVersion = await touRepository.getPendingVersion()

  if (!activeVersion) {
    return {
      accepted: true,
      currentVersion: null,
      pendingVersion: pendingVersion
        ? {
            versionLabel: pendingVersion.versionLabel,
            effectiveDate: pendingVersion.effectiveDate,
            contentUrl: pendingVersion.contentUrl,
            changeType: pendingVersion.changeType,
          }
        : null,
    }
  }

  const accepted = await touRepository.hasUserAcceptedVersion(
    user.publicId,
    activeVersion.id,
  )

  return {
    accepted,
    currentVersion: {
      id: activeVersion.id,
      versionLabel: activeVersion.versionLabel,
      contentUrl: activeVersion.contentUrl,
      changeType: activeVersion.changeType,
      effectiveDate: activeVersion.effectiveDate,
    },
    pendingVersion: pendingVersion
      ? {
          versionLabel: pendingVersion.versionLabel,
          effectiveDate: pendingVersion.effectiveDate,
          contentUrl: pendingVersion.contentUrl,
          changeType: pendingVersion.changeType,
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// acceptCurrentVersion — user-facing
// ---------------------------------------------------------------------------

const acceptCurrentVersion = async (
  user: UserWithOrganization,
  ipAddress: string | null,
): Promise<Result<TouAcceptance | null, NotFoundError>> => {
  const activeVersion = await touRepository.ensureActiveVersion()
  if (!activeVersion) {
    return err(new NotFoundError('No active ToU version'))
  }

  const acceptance = await touRepository.createAcceptance(
    user.publicId,
    activeVersion.id,
    ipAddress,
  )

  logger.info('User accepted ToU version %s', activeVersion.versionLabel, {
    userId: user.publicId,
    versionId: activeVersion.id,
  })

  return ok(acceptance)
}

// ---------------------------------------------------------------------------
// Admin: createTouVersion
// ---------------------------------------------------------------------------

type CreateTouVersionParams = {
  versionLabel: string
  effectiveDate: Date
  contentUrl: string
  changeType: TouChangeType
  adminNotes: string | null
}

const createTouVersion = async (
  executor: User,
  params: CreateTouVersionParams,
): Promise<Result<TouVersion, ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    logger.warn('Non-admin user attempted to create ToU version', {
      publicId: executor.publicId,
    })
    return err(new ForbiddenError('Admin access required'))
  }

  const version = await touRepository.createVersion({
    ...params,
    createdBy: executor.publicId,
  })

  logger.info('ToU version %s created as draft', version.versionLabel, {
    id: version.id,
    createdBy: executor.publicId,
  })

  return ok(version)
}

// ---------------------------------------------------------------------------
// Admin: updateTouVersion — only drafts can be edited
// ---------------------------------------------------------------------------

type UpdateTouVersionParams = {
  versionLabel?: string
  effectiveDate?: Date
  contentUrl?: string
  changeType?: TouChangeType
  adminNotes?: string | null
}

const updateTouVersion = async (
  executor: User,
  id: string,
  params: UpdateTouVersionParams,
): Promise<
  Result<TouVersion, ForbiddenError | NotFoundError | BadRequestError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const existing = await touRepository.getVersionById(id)
  if (!existing) {
    return err(new NotFoundError('ToU version not found'))
  }

  if (existing.status !== TouVersionStatus.Draft) {
    return err(
      new BadRequestError('Only draft versions can be edited'),
    )
  }

  const updated = await touRepository.updateVersion(id, params)
  if (!updated) {
    return ok(existing)
  }

  return ok(updated)
}

// ---------------------------------------------------------------------------
// Admin: promoteToPending
// Validates 30-day notice for material changes. Admin can override with reason.
// Auto-creates a banner for advance notice of material changes.
// ---------------------------------------------------------------------------

const promoteToPending = async (
  executor: User,
  id: string,
  overrideNotice?: boolean,
  overrideReason?: string,
): Promise<
  Result<TouVersion, ForbiddenError | NotFoundError | BadRequestError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const version = await touRepository.getVersionById(id)
  if (!version) {
    return err(new NotFoundError('ToU version not found'))
  }

  if (version.status !== TouVersionStatus.Draft) {
    return err(new BadRequestError('Only draft versions can be promoted'))
  }

  const existingPending = await touRepository.getPendingVersion()
  if (existingPending) {
    return err(
      new BadRequestError(
        'A pending version already exists. Archive it before promoting another.',
      ),
    )
  }

  if (version.changeType === TouChangeType.Material) {
    const daysUntilEffective = Math.floor(
      (version.effectiveDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    )

    if (daysUntilEffective < NOTICE_DAYS) {
      if (!overrideNotice) {
        return err(
          new BadRequestError(
            `Material changes require at least ${NOTICE_DAYS} days notice. ` +
              `Effective date is only ${daysUntilEffective} days away. ` +
              'Set overrideNotice=true with a reason for emergency changes.',
          ),
        )
      }

      if (!overrideReason || overrideReason.trim().length === 0) {
        return err(
          new BadRequestError(
            'A reason is required when overriding the notice period',
          ),
        )
      }

      logger.warn(
        'Admin overriding %d-day notice for ToU version %s: %s',
        NOTICE_DAYS,
        version.versionLabel,
        overrideReason,
        { adminId: executor.publicId },
      )

      await touRepository.updateVersion(id, {
        adminNotes: `${version.adminNotes ? version.adminNotes + '\n' : ''}[EMERGENCY OVERRIDE] ${overrideReason}`,
      })
    }
  }

  const promoted = await touRepository.updateVersionStatus(
    id,
    TouVersionStatus.Pending,
  )

  if (version.changeType === TouChangeType.Material) {
    await bannersRepository.createBanner({
      title: `Terms of Use Update (${version.versionLabel})`,
      body:
        'Updated Terms of Use take effect on ' +
        `${version.effectiveDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. ` +
        `Review the changes: ${version.contentUrl}`,
      criticality: BannerCriticality.Warning,
      dismissable: true,
      requiresAcknowledgement: false,
      displayStart: new Date(),
      displayEnd: version.effectiveDate,
      active: true,
      createdBy: executor.publicId,
    })

    logger.info(
      'Created advance notice banner for ToU version %s',
      version.versionLabel,
    )
  }

  logger.info('ToU version %s promoted to pending', version.versionLabel, {
    id,
    adminId: executor.publicId,
  })

  return ok(promoted!)
}

// ---------------------------------------------------------------------------
// Admin: activateVersion — manual early activation
// ---------------------------------------------------------------------------

const activateVersion = async (
  executor: User,
  id: string,
): Promise<
  Result<TouVersion, ForbiddenError | NotFoundError | BadRequestError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const version = await touRepository.getVersionById(id)
  if (!version) {
    return err(new NotFoundError('ToU version not found'))
  }

  if (version.status !== TouVersionStatus.Pending) {
    return err(
      new BadRequestError('Only pending versions can be activated'),
    )
  }

  const activated = await touRepository.activateVersionTransactional(id)

  logger.info('ToU version %s manually activated', version.versionLabel, {
    id,
    adminId: executor.publicId,
  })

  return ok(activated!)
}

// ---------------------------------------------------------------------------
// Admin: archiveVersion
// ---------------------------------------------------------------------------

const archiveVersion = async (
  executor: User,
  id: string,
): Promise<
  Result<TouVersion, ForbiddenError | NotFoundError | BadRequestError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const version = await touRepository.getVersionById(id)
  if (!version) {
    return err(new NotFoundError('ToU version not found'))
  }

  if (
    version.status !== TouVersionStatus.Pending &&
    version.status !== TouVersionStatus.Active
  ) {
    return err(
      new BadRequestError(
        'Only pending or active versions can be archived',
      ),
    )
  }

  const archived = await touRepository.updateVersionStatus(
    id,
    TouVersionStatus.Archived,
  )

  logger.info('ToU version %s archived', version.versionLabel, {
    id,
    adminId: executor.publicId,
  })

  return ok(archived!)
}

// ---------------------------------------------------------------------------
// Admin: getAllVersions
// ---------------------------------------------------------------------------

const getAllVersions = async (
  executor: User,
): Promise<Result<TouVersion[], ForbiddenError>> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const versions = await touRepository.getAllVersions()
  return ok(versions)
}

// ---------------------------------------------------------------------------
// Admin: getVersionWithStats
// ---------------------------------------------------------------------------

const getVersionWithStats = async (
  executor: User,
  id: string,
): Promise<
  Result<TouVersionWithStats, ForbiddenError | NotFoundError>
> => {
  if (executor.role !== UserRole.Admin) {
    return err(new ForbiddenError('Admin access required'))
  }

  const stats = await touRepository.getVersionWithStats(id)
  if (!stats) {
    return err(new NotFoundError('ToU version not found'))
  }

  return ok(stats)
}

export const TouUseCases = {
  getTouStatus,
  acceptCurrentVersion,
  createTouVersion,
  updateTouVersion,
  promoteToPending,
  activateVersion,
  archiveVersion,
  getAllVersions,
  getVersionWithStats,
}

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { DeletionUseCases } from '../../../src/core/users/deletion.js'
import { deletionAuditRepository } from '../../../src/infrastructure/repositories/deletionAudit.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import {
  DeletionAuditEntry,
  DeletionRequest,
  DeletionRequestStatus,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { ForbiddenError } from '../../../src/errors/index.js'
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

const makeAuditEntry = (
  overrides: Partial<DeletionAuditEntry> = {},
): DeletionAuditEntry => ({
  id: uuidv4(),
  userPublicId: uuidv4(),
  action: 'anonymisation_completed',
  details: null,
  performedAt: new Date(),
  ...overrides,
})

const makeDeletionRequest = (
  overrides: Partial<DeletionRequest> = {},
): DeletionRequest => ({
  id: uuidv4(),
  userPublicId: uuidv4(),
  oauthProvider: 'google',
  oauthUserId: uuidv4(),
  status: DeletionRequestStatus.Pending,
  requestedAt: new Date(),
  scheduledAnonymisationAt: new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ),
  completedAt: null,
  cancelledAt: null,
  reason: null,
  adminNotes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

// ---------------------------------------------------------------------------
// Admin-only operations — non-admin should receive ForbiddenError
// ---------------------------------------------------------------------------

describe('DeletionUseCases — admin-only endpoints return 403 for non-admin users', () => {
  const regularUser = makeUser(UserRole.User)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('getAuditLog: returns ForbiddenError for non-admin', async () => {
    const result = await DeletionUseCases.getAuditLog(
      regularUser,
      'some-public-id',
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ForbiddenError)
    }
  })

  it('getStats: returns ForbiddenError for non-admin', async () => {
    const result = await DeletionUseCases.getStats(regularUser)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ForbiddenError)
    }
  })
})

// ---------------------------------------------------------------------------
// Admin operations — admin user
// ---------------------------------------------------------------------------

describe('DeletionUseCases — admin operations', () => {
  const adminUser = makeUser(UserRole.Admin)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('getAuditLog: returns audit entries for admin', async () => {
    const entries = [makeAuditEntry(), makeAuditEntry()]
    jest
      .spyOn(deletionAuditRepository, 'getByUser')
      .mockResolvedValue(entries)

    const result = await DeletionUseCases.getAuditLog(
      adminUser,
      'some-public-id',
    )
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toHaveLength(2)
    }
  })

  it('getStats: returns stats for admin', async () => {
    const stats = { totalAnonymisations: 5, recentAnonymisations: 2 }
    jest
      .spyOn(deletionAuditRepository, 'getStats')
      .mockResolvedValue(stats)

    const result = await DeletionUseCases.getStats(adminUser)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.totalAnonymisations).toBe(5)
      expect(result.value.recentAnonymisations).toBe(2)
    }
  })
})

// ---------------------------------------------------------------------------
// processAnonymisation
// ---------------------------------------------------------------------------

describe('DeletionUseCases — processAnonymisation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('skips request if markAsProcessing returns null (already processed)', async () => {
    const request = makeDeletionRequest()

    jest
      .spyOn(AuthManager, 'markDeletionAsProcessing')
      .mockResolvedValue(null)

    const executeAuthSpy = jest
      .spyOn(AuthManager, 'executeAuthAnonymisation')
      .mockResolvedValue(undefined)

    await DeletionUseCases.processAnonymisation(request)

    expect(executeAuthSpy).not.toHaveBeenCalled()
  })

  it('marks as failed when backend anonymisation throws', async () => {
    const request = makeDeletionRequest()

    jest
      .spyOn(AuthManager, 'markDeletionAsProcessing')
      .mockResolvedValue(
        makeDeletionRequest({
          status: DeletionRequestStatus.Processing,
        }),
      )

    const failSpy = jest
      .spyOn(AuthManager, 'markDeletionAsFailed')
      .mockResolvedValue(
        makeDeletionRequest({ status: DeletionRequestStatus.Failed }),
      )

    // anonymiseBackendData will hit the test DB which lacks the
    // object_ownership table, causing a real DB error
    await DeletionUseCases.processAnonymisation(request)

    expect(failSpy).toHaveBeenCalledWith(
      request.id,
      expect.stringContaining('Anonymisation failed'),
    )
  })

  it('marks as failed when markDeletionAsProcessing rejects', async () => {
    const request = makeDeletionRequest()

    jest
      .spyOn(AuthManager, 'markDeletionAsProcessing')
      .mockRejectedValue(new Error('Network error'))

    const failSpy = jest
      .spyOn(AuthManager, 'markDeletionAsFailed')
      .mockResolvedValue(
        makeDeletionRequest({ status: DeletionRequestStatus.Failed }),
      )

    await DeletionUseCases.processAnonymisation(request)

    expect(failSpy).toHaveBeenCalledWith(
      request.id,
      expect.stringContaining('Network error'),
    )
  })
})

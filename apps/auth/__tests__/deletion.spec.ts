import { DeletionUseCases } from '../src/useCases/deletion.js'
import { UsersUseCases } from '../src/useCases/users.js'
import { DeletionRequestStatus, User } from '@auto-drive/models'
import { closeDatabase, getDatabase } from '../src/drivers/pg.js'
import { dbMigration } from './utils/dbMigrate.js'
import { createUnonboardedUser } from './utils/mocks.js'

describe('DeletionUseCases', () => {
  let testUser: User

  beforeAll(async () => {
    await getDatabase()
    await dbMigration.up()

    // Onboard a test user
    const unonboarded = createUnonboardedUser()
    const onboarded = await UsersUseCases.onboardUser(unonboarded)
    if (!onboarded) {
      throw new Error('Failed to onboard test user')
    }
    testUser = onboarded
  })

  afterAll(async () => {
    await closeDatabase()
    await dbMigration.down()
  })

  it('should create a deletion request', async () => {
    const request = await DeletionUseCases.requestDeletion(
      testUser,
      'Testing deletion',
    )

    expect(request).toBeDefined()
    expect(request.userPublicId).toBe(testUser.publicId)
    expect(request.status).toBe(DeletionRequestStatus.Pending)
    expect(request.reason).toBe('Testing deletion')
    expect(request.scheduledAnonymisationAt).toBeDefined()

    // Scheduled date should be approximately 30 days from now
    const scheduledDate = new Date(request.scheduledAnonymisationAt)
    const now = new Date()
    const diffDays =
      (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(29)
    expect(diffDays).toBeLessThan(31)
  })

  it('should return existing request if one is already pending', async () => {
    const request1 = await DeletionUseCases.requestDeletion(testUser)
    const request2 = await DeletionUseCases.requestDeletion(testUser)

    expect(request1.id).toBe(request2.id)
  })

  it('should return deletion status for user', async () => {
    const status = await DeletionUseCases.getDeletionStatus(testUser)

    expect(status).toBeDefined()
    expect(status?.status).toBe(DeletionRequestStatus.Pending)
  })

  it('should cancel a deletion request', async () => {
    const cancelled = await DeletionUseCases.cancelDeletion(testUser)

    expect(cancelled).toBeDefined()
    expect(cancelled?.status).toBe(DeletionRequestStatus.Cancelled)
  })

  it('should return null when no pending request exists', async () => {
    const status = await DeletionUseCases.getDeletionStatus(testUser)
    expect(status).toBeNull()
  })

  it('should return null when cancelling with no pending request', async () => {
    const result = await DeletionUseCases.cancelDeletion(testUser)
    expect(result).toBeNull()
  })

  describe('admin operations', () => {
    it('should throw for non-admin user listing deletion requests', async () => {
      await expect(
        DeletionUseCases.getAllDeletionRequests(testUser),
      ).rejects.toThrow('User does not have admin privileges')
    })

    it('should throw for non-admin user updating admin notes', async () => {
      await expect(
        DeletionUseCases.updateAdminNotes(testUser, 'some-id', 'notes'),
      ).rejects.toThrow('User does not have admin privileges')
    })
  })
})

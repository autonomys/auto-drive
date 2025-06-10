import { UserWithOrganization } from '@auto-drive/models'
import { getDatabase } from '../../../src/drivers/pg.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { NotificationsUseCases } from '../../../src/useCases/users/notifications.js'
import { notificationsRepository } from '../../../src/repositories/notifications/notifications.js'

describe('NotificationsUseCases', () => {
  let mockUser: UserWithOrganization

  beforeEach(async () => {
    mockRabbitPublish()
    await getDatabase()
    await dbMigration.up()
    mockUser = createMockUser()
  })

  afterEach(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  describe('getListeningNotifications', () => {
    it('should return default notification IDs for a new user', async () => {
      const result = await NotificationsUseCases.getListeningNotifications(
        mockUser.publicId,
      )

      expect(result).toEqual(['notification.credits.low'])

      // Verify it was created in the database
      const dbConfig = await notificationsRepository.getListeningNotifications(
        mockUser.publicId,
      )
      expect(dbConfig).toBeDefined()
      expect(dbConfig?.listeningNotificationIds).toEqual([
        'notification.credits.low',
      ])
    })

    it('should return existing notification IDs for an existing user', async () => {
      const customNotificationIds = [
        'notification.credits.low',
        'notification.custom',
      ]

      // Create notification config first
      await notificationsRepository.createNotification(
        mockUser.publicId,
        customNotificationIds,
      )

      // Get notifications
      const result = await NotificationsUseCases.getListeningNotifications(
        mockUser.publicId,
      )

      expect(result).toEqual(customNotificationIds)
    })
  })

  describe('updateListeningNotifications', () => {
    it('should update notification IDs for a user', async () => {
      // Setup initial notifications
      await NotificationsUseCases.getListeningNotifications(mockUser.publicId)

      // Update with new notification IDs
      const newNotificationIds = [
        'notification.new.type',
        'notification.credits.low',
      ]
      const result = await NotificationsUseCases.updateListeningNotifications(
        mockUser.publicId,
        newNotificationIds,
      )

      expect(result).toEqual(newNotificationIds)

      // Verify it was updated in the database
      const dbConfig = await notificationsRepository.getListeningNotifications(
        mockUser.publicId,
      )
      expect(dbConfig).toBeDefined()
      expect(dbConfig?.listeningNotificationIds).toEqual(newNotificationIds)
    })

    it('should handle updating to an empty notification list', async () => {
      // Setup initial notifications
      await NotificationsUseCases.getListeningNotifications(mockUser.publicId)

      // Update with empty notification IDs
      const newNotificationIds: string[] = []
      const result = await NotificationsUseCases.updateListeningNotifications(
        mockUser.publicId,
        newNotificationIds,
      )

      expect(result).toEqual(newNotificationIds)

      // Verify it was updated in the database
      const dbConfig = await notificationsRepository.getListeningNotifications(
        mockUser.publicId,
      )
      expect(dbConfig).toBeDefined()
      expect(dbConfig?.listeningNotificationIds).toEqual(newNotificationIds)
    })
  })
})

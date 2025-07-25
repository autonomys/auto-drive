/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { Task } from '../../src/infrastructure/eventRouter/tasks.js'
import { Rabbit as RabbitT } from '../../src/infrastructure/drivers/rabbit.js'
import { EventRouter as EventRouterT } from '../../src/infrastructure/eventRouter/index.js'
import { UploadsUseCases as UploadsUseCasesT } from '../../src/core/uploads/uploads.js'
import { OnchainPublisher as OnchainPublisherT } from '../../src/infrastructure/services/upload/onchainPublisher/index.js'
import type { Logger } from '../../src/infrastructure/drivers/logger.js'
import { closeDatabase } from '../../src/infrastructure/drivers/pg.js'

// Mock dependencies before imports
jest.unstable_mockModule('../../src/infrastructure/drivers/rabbit.js', () => ({
  Rabbit: {
    subscribe: jest.fn(),
    publish: jest.fn(),
  },
}))

jest.unstable_mockModule('../../src/core/objects/index.js', () => ({
  NodesUseCases: {
    processNodeArchived: jest.fn(),
  },
}))

jest.unstable_mockModule('../../src/core/uploads/uploads.js', () => ({
  UploadsUseCases: {
    processMigration: jest.fn(),
    tagUpload: jest.fn(),
  },
}))

jest.unstable_mockModule(
  '../../src/infrastructure/services/upload/onchainPublisher/index.js',
  () => ({
    OnchainPublisher: {
      publishNodes: jest.fn(),
    },
  }),
)

jest.unstable_mockModule('../../src/infrastructure/drivers/logger.js', () => {
  // Return a mock createLogger that yields a mocked logger instance
  const mockedLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }
  return {
    createLogger: jest.fn().mockImplementation(() => mockedLogger),
    // Re-export Logger type for TS but not necessary at runtime
  }
})

describe('TaskManager', () => {
  let subscribeCallback: (obj: Record<string, unknown>) => Promise<unknown>
  let EventRouter: typeof EventRouterT
  let Rabbit: typeof RabbitT
  let UploadsUseCases: typeof UploadsUseCasesT
  let OnchainPublisher: typeof OnchainPublisherT
  let logger: Logger
  beforeAll(async () => {
    // Import modules after mocks
    EventRouter = (
      await import('../../src/infrastructure/eventRouter/index.js')
    ).EventRouter
    Rabbit = (await import('../../src/infrastructure/drivers/rabbit.js')).Rabbit
    UploadsUseCases = (await import('../../src/core/uploads/uploads.js'))
      .UploadsUseCases
    OnchainPublisher = (
      await import(
        '../../src/infrastructure/services/upload/onchainPublisher/index.js'
      )
    ).OnchainPublisher
    logger = (
      await import('../../src/infrastructure/drivers/logger.js')
    ).createLogger('test')
  })

  beforeEach(() => {
    jest.clearAllMocks()

    // Capture the callback passed to Rabbit.subscribe
    jest
      .mocked(Rabbit.subscribe)
      .mockImplementation(async (queue, callback) => {
        subscribeCallback = callback
        return Promise.resolve(() => {})
      })
  })

  afterAll(async () => {
    await closeDatabase()
  })

  describe('start', () => {
    it('should subscribe to the task manager queue', () => {
      EventRouter.listenFrontendEvents()
      expect(Rabbit.subscribe).toHaveBeenCalledWith(
        'task-manager',
        expect.any(Function),
      )
    })

    it('should subscribe to the download manager queue', () => {
      EventRouter.listenDownloadEvents()
      expect(Rabbit.subscribe).toHaveBeenCalledWith(
        'download-manager',
        expect.any(Function),
      )
    })

    it('should log an error when receiving an invalid task', async () => {
      EventRouter.listenFrontendEvents()
      await subscribeCallback({})
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Invalid task',
      )
    })

    it('should process a valid task', async () => {
      EventRouter.listenFrontendEvents()
      const validTask = {
        id: 'migrate-upload-nodes',
        params: { uploadId: '123' },
        retriesLeft: 3,
      }

      await subscribeCallback(validTask)

      expect(UploadsUseCases.processMigration).toHaveBeenCalledWith('123')
    })

    it('should log an error when a task fails and has no retries left', async () => {
      EventRouter.listenFrontendEvents()
      const validTask = {
        id: 'publish-nodes',
        params: { nodes: ['node1', 'node2'] },
        retriesLeft: 0,
      }

      jest
        .mocked(OnchainPublisher.publishNodes)
        .mockImplementationOnce(async () => {
          throw new Error('Test error')
        })

      await subscribeCallback(validTask)

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Task failed',
      )
      expect(Rabbit.publish).toHaveBeenCalledWith(
        'frontend-errors',
        expect.any(Object),
      )
    })
  })

  describe('publish', () => {
    it('should publish a single task', () => {
      const task: Task = {
        id: 'tag-upload',
        params: { cid: 'test-cid' },
        retriesLeft: 3,
      }

      EventRouter.publish(task)

      expect(Rabbit.publish).toHaveBeenCalledWith('task-manager', task)
    })

    it('should publish multiple tasks', () => {
      const tasks: Task[] = [
        {
          id: 'tag-upload',
          params: { cid: 'test-cid-1' },
          retriesLeft: 3,
        },
        {
          id: 'publish-nodes',
          params: { nodes: ['node1'] },
          retriesLeft: 3,
        },
      ]

      EventRouter.publish(tasks)

      expect(Rabbit.publish).toHaveBeenCalledTimes(2)
      expect(Rabbit.publish).toHaveBeenCalledWith('task-manager', tasks[0])
      expect(Rabbit.publish).toHaveBeenCalledWith('task-manager', tasks[1])
    })
  })
})

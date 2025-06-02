/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { Task } from '../../src/services/taskManager/tasks.js'
import { Rabbit as RabbitT } from '../../src/drivers/rabbit.js'
import { TaskManager as TaskManagerT } from '../../src/services/taskManager/index.js'
import { UploadsUseCases as UploadsUseCasesT } from '../../src/useCases/uploads/uploads.js'
import { OnchainPublisher as OnchainPublisherT } from '../../src/services/upload/onchainPublisher/index.js'
import { logger as LoggerT } from '../../src/drivers/logger.js'

// Mock dependencies before imports
jest.unstable_mockModule('../../src/drivers/rabbit.js', () => ({
  Rabbit: {
    subscribe: jest.fn(),
    publish: jest.fn(),
  },
}))

jest.unstable_mockModule('../../src/useCases/objects/nodes.js', () => ({
  NodesUseCases: {
    processNodeArchived: jest.fn(),
  },
}))

jest.unstable_mockModule('../../src/useCases/uploads/uploads.js', () => ({
  UploadsUseCases: {
    processMigration: jest.fn(),
    tagUpload: jest.fn(),
  },
}))

jest.unstable_mockModule(
  '../../src/services/upload/onchainPublisher/index.js',
  () => ({
    OnchainPublisher: {
      publishNodes: jest.fn(),
    },
  }),
)

jest.unstable_mockModule('../../src/drivers/logger.js', () => ({
  logger: {
    error: jest.fn(),
  },
}))

describe('TaskManager', () => {
  let subscribeCallback: (obj: object) => Promise<unknown>
  let TaskManager: typeof TaskManagerT
  let Rabbit: typeof RabbitT
  let UploadsUseCases: typeof UploadsUseCasesT
  let OnchainPublisher: typeof OnchainPublisherT
  let logger: typeof LoggerT
  beforeAll(async () => {
    // Import modules after mocks
    TaskManager = (await import('../../src/services/taskManager/index.js'))
      .TaskManager
    Rabbit = (await import('../../src/drivers/rabbit.js')).Rabbit
    UploadsUseCases = (await import('../../src/useCases/uploads/uploads.js'))
      .UploadsUseCases
    OnchainPublisher = (
      await import('../../src/services/upload/onchainPublisher/index.js')
    ).OnchainPublisher
    logger = (await import('../../src/drivers/logger.js')).logger
  })

  beforeEach(() => {
    jest.clearAllMocks()

    // Capture the callback passed to Rabbit.subscribe
    jest.mocked(Rabbit.subscribe).mockImplementation(async (callback) => {
      subscribeCallback = callback
      return Promise.resolve(() => {})
    })
  })

  describe('start', () => {
    it('should subscribe to the rabbit queue', () => {
      TaskManager.start()
      expect(Rabbit.subscribe).toHaveBeenCalled()
    })

    it('should log an error when receiving an invalid task', async () => {
      TaskManager.start()
      await subscribeCallback({})
      expect(logger.error).toHaveBeenCalledWith(
        'Invalid task',
        expect.anything(),
      )
    })

    it('should process a valid task', async () => {
      TaskManager.start()
      const validTask = {
        id: 'migrate-upload-nodes',
        params: { uploadId: '123' },
        retriesLeft: 3,
      }

      await subscribeCallback(validTask)

      expect(UploadsUseCases.processMigration).toHaveBeenCalledWith('123')
    })

    it('should log an error when a task fails and has no retries left', async () => {
      TaskManager.start()
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
        'Task failed',
        expect.anything(),
      )
      expect(Rabbit.publish).not.toHaveBeenCalled()
    })
  })

  describe('publish', () => {
    it('should publish a single task', () => {
      const task: Task = {
        id: 'tag-upload',
        params: { cid: 'test-cid' },
        retriesLeft: 3,
      }

      TaskManager.publish(task)

      expect(Rabbit.publish).toHaveBeenCalledWith(task)
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

      TaskManager.publish(tasks)

      expect(Rabbit.publish).toHaveBeenCalledTimes(2)
      expect(Rabbit.publish).toHaveBeenCalledWith(tasks[0])
      expect(Rabbit.publish).toHaveBeenCalledWith(tasks[1])
    })
  })
})

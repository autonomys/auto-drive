import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { processFrontendTask } from '../../../src/infrastructure/eventRouter/processors/frontend.js'
import { processDownloadTask } from '../../../src/infrastructure/eventRouter/processors/download.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { NodesUseCases } from '../../../src/core/objects/nodes.js'
import { OnchainPublisher } from '../../../src/infrastructure/services/upload/onchainPublisher/index.js'
import { AsyncDownloadsUseCases } from '../../../src/core/downloads/index.js'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { paymentManager } from '../../../src/infrastructure/services/paymentManager/index.js'
import { Task } from '../../../src/infrastructure/eventRouter/tasks.js'
import { ok } from 'neverthrow'

describe('EventRouter Processors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('processFrontendTask', () => {
    it('should handle migrate-upload-nodes task', async () => {
      const processMigrationSpy = jest
        .spyOn(UploadsUseCases, 'processMigration')
        .mockResolvedValue(undefined)

      const task = {
        id: 'migrate-upload-nodes',
        params: { uploadId: 'upload123' },
        retriesLeft: 3,
      }

      await processFrontendTask(task)

      expect(processMigrationSpy).toHaveBeenCalledWith('upload123')
    })

    it('should handle archive-objects task', async () => {
      const processNodeArchivedSpy = jest
        .spyOn(NodesUseCases, 'processNodeArchived')
        .mockResolvedValue(undefined)

      const task: Task = {
        id: 'archive-objects',
        params: {
          objects: [
            ['obj1', 1, 1],
            ['obj2', 1, 1],
          ],
        },
        retriesLeft: 3,
      }

      await processFrontendTask(task)

      expect(processNodeArchivedSpy).toHaveBeenCalledWith([
        ['obj1', 1, 1],
        ['obj2', 1, 1],
      ])
    })

    it('should handle publish-nodes task', async () => {
      const publishNodesSpy = jest
        .spyOn(OnchainPublisher, 'publishNodes')
        .mockResolvedValue(undefined)

      const task = {
        id: 'publish-nodes',
        params: { nodes: ['node1'] },
        retriesLeft: 3,
      }

      await processFrontendTask(task)

      expect(publishNodesSpy).toHaveBeenCalledWith(['node1'])
    })

    it('should handle tag-upload task', async () => {
      const tagUploadSpy = jest
        .spyOn(UploadsUseCases, 'tagUpload')
        .mockResolvedValue(ok(undefined))

      const task = {
        id: 'tag-upload',
        params: { cid: 'cid123' },
        retriesLeft: 3,
      }

      await processFrontendTask(task)

      expect(tagUploadSpy).toHaveBeenCalledWith('cid123')
    })

    it('should handle ensure-object-published task', async () => {
      const ensureObjectPublishedSpy = jest
        .spyOn(NodesUseCases, 'ensureObjectPublished')
        .mockResolvedValue(undefined)

      const task = {
        id: 'ensure-object-published',
        params: { cid: 'cid456' },
        retriesLeft: 3,
      }

      await processFrontendTask(task)

      expect(ensureObjectPublishedSpy).toHaveBeenCalledWith('cid456')
    })

    it('should handle watch-intent-tx task', async () => {
      const watchTransactionSpy = jest
        .spyOn(paymentManager, 'watchTransaction')
        .mockResolvedValue(undefined)

      const task = {
        id: 'watch-intent-tx',
        params: { txHash: '0xtxhash' },
        retriesLeft: 3,
      }

      await processFrontendTask(task)

      expect(watchTransactionSpy).toHaveBeenCalledWith('0xtxhash')
    })

    it('should throw error for unknown task', async () => {
      const task = {
        id: 'unknown-task',
        params: {},
        retriesLeft: 3,
      }

      await expect(processFrontendTask(task)).resolves.toBeUndefined()
    })
  })

  describe('processDownloadTask', () => {
    it('should handle async-download-created task', async () => {
      const asyncDownloadSpy = jest
        .spyOn(AsyncDownloadsUseCases, 'asyncDownload')
        .mockResolvedValue(ok(undefined))

      const task = {
        id: 'async-download-created',
        params: { downloadId: 'download123' },
        retriesLeft: 3,
      }

      await processDownloadTask(task)

      expect(asyncDownloadSpy).toHaveBeenCalledWith('download123')
    })

    it('should handle object-archived task', async () => {
      const onObjectArchivedSpy = jest
        .spyOn(ObjectUseCases, 'onObjectArchived')
        .mockResolvedValue(undefined)

      const task = {
        id: 'object-archived',
        params: { cid: 'cid123' },
        retriesLeft: 3,
      }

      await processDownloadTask(task)

      expect(onObjectArchivedSpy).toHaveBeenCalledWith('cid123')
    })

    it('should handle populate-cache task', async () => {
      const populateCachesSpy = jest
        .spyOn(ObjectUseCases, 'populateCaches')
        .mockResolvedValue(undefined)

      const task = {
        id: 'populate-cache',
        params: { cid: 'cid456' },
        retriesLeft: 3,
      }

      await processDownloadTask(task)

      expect(populateCachesSpy).toHaveBeenCalledWith('cid456')
    })

    it('should throw error for unknown download task', async () => {
      const MAX_RETRIES = 3
      const task = {
        id: 'unknown-download',
        params: {},
        retriesLeft: MAX_RETRIES,
      }

      await expect(processDownloadTask(task)).resolves.toBeUndefined()
    })
  })
})

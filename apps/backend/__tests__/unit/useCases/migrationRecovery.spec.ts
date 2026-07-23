import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { MigrationRecoveryUseCases } from '../../../src/core/uploads/migrationRecovery.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { config } from '../../../src/config.js'

describe('MigrationRecoveryUseCases.processMigrationRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('re-enqueues one migrate-upload-nodes task per stuck upload and marks the attempt', async () => {
    const ids = ['upload-1', 'upload-2', 'upload-3']
    jest
      .spyOn(uploadsRepository, 'getStuckRootMigrations')
      .mockResolvedValue(ids)
    const markSpy = jest
      .spyOn(uploadsRepository, 'markMigrationRecoveryAttempt')
      .mockResolvedValue(undefined)
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await MigrationRecoveryUseCases.processMigrationRecovery()

    expect(publishSpy).toHaveBeenCalledTimes(3)
    const tasks = publishSpy.mock.calls.map(
      (call) => call[0] as { id: string; params: { uploadId: string } },
    )
    expect(tasks.map((task) => task.id)).toEqual([
      'migrate-upload-nodes',
      'migrate-upload-nodes',
      'migrate-upload-nodes',
    ])
    expect(tasks.map((task) => task.params.uploadId)).toEqual(ids)
    // Only the uploads we actually re-drove are stamped (rate-limit window).
    expect(markSpy).toHaveBeenCalledWith(ids)
  })

  it('does nothing when there are no stuck migrations', async () => {
    jest
      .spyOn(uploadsRepository, 'getStuckRootMigrations')
      .mockResolvedValue([])
    const markSpy = jest
      .spyOn(uploadsRepository, 'markMigrationRecoveryAttempt')
      .mockResolvedValue(undefined)
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await MigrationRecoveryUseCases.processMigrationRecovery()

    expect(publishSpy).not.toHaveBeenCalled()
    expect(markSpy).not.toHaveBeenCalled()
  })

  it('queries the repository with the configured staleness window and per-cycle limit', async () => {
    const getSpy = jest
      .spyOn(uploadsRepository, 'getStuckRootMigrations')
      .mockResolvedValue([])
    jest
      .spyOn(uploadsRepository, 'markMigrationRecoveryAttempt')
      .mockResolvedValue(undefined)
    jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await MigrationRecoveryUseCases.processMigrationRecovery()

    expect(getSpy).toHaveBeenCalledWith(
      config.migrationRecovery.stalenessMs,
      config.migrationRecovery.maxUploadsPerCycle,
    )
  })
})

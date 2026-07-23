import { uploadsRepository } from '../../infrastructure/repositories/uploads/uploads.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { createTask } from '../../infrastructure/eventRouter/tasks.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { config } from '../../config.js'

const logger = createLogger('useCases:uploads:migrationRecovery')

// Concurrency guard — skip if a recovery pass is already running.
let isRunning = false

/**
 * Recovers uploads stranded in the MIGRATING state.
 *
 * Migration is driven by a single fire-and-forget `migrate-upload-nodes` task
 * enqueued once at upload completion (see scheduleNodeMigration). If that task
 * is lost or fails all of its retries — landing in the unconsumed
 * frontend-errors queue — the row stays MIGRATING forever with nothing to
 * re-drive it, unlike publishing and archival which already have recovery
 * loops. This sweep re-enqueues the migrate task for any root upload that has
 * been MIGRATING past the staleness window.
 *
 * Safety:
 * - Only root uploads idle longer than `stalenessMs` are selected, so a
 *   healthy in-flight migration is never double-driven (processMigration is
 *   not concurrency-guarded and saveNodes does plain INSERTs).
 * - Each re-drive stamps updated_at=now(), so a genuinely failing upload is
 *   retried at most once per window rather than every cycle.
 * - A successful migration deletes its upload rows (removeUploadArtifacts), so
 *   recovered uploads drop out of the sweep automatically.
 *
 * Queue deferral (skip while the task-manager queue is busy) is handled by the
 * scheduler in migrationRecoveryJob.ts, not here, so task-triggered runs
 * always execute.
 */
const processMigrationRecovery = async (): Promise<void> => {
  if (isRunning) {
    logger.debug('Migration recovery already in progress, skipping')
    return
  }

  isRunning = true
  try {
    await runRecoveryBatch()
  } finally {
    isRunning = false
  }
}

const runRecoveryBatch = async (): Promise<void> => {
  const { maxUploadsPerCycle, stalenessMs } = config.migrationRecovery

  const stuckUploadIds = await uploadsRepository.getStuckRootMigrations(
    stalenessMs,
    maxUploadsPerCycle,
  )

  if (stuckUploadIds.length === 0) {
    logger.debug('No stuck migrations found, skipping')
    return
  }

  logger.warn(
    'Found %d uploads stuck in migrating, re-enqueuing migrate-upload-nodes: %s',
    stuckUploadIds.length,
    stuckUploadIds.join(', '),
  )

  for (const uploadId of stuckUploadIds) {
    EventRouter.publish(
      createTask({ id: 'migrate-upload-nodes', params: { uploadId } }),
    )
  }

  // Rate-limit: stamp updated_at so these uploads are not re-selected for a
  // full staleness window, whether or not the re-driven migration succeeds.
  await uploadsRepository.markMigrationRecoveryAttempt(stuckUploadIds)
}

export const MigrationRecoveryUseCases = {
  processMigrationRecovery,
}

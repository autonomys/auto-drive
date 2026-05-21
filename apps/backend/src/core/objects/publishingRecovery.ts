import { nodesRepository } from '../../infrastructure/repositories/index.js'
import { OnchainPublisher } from '../../infrastructure/services/upload/onchainPublisher/index.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { config } from '../../config.js'

const logger = createLogger('useCases:objects:publishingRecovery')

// Concurrency guard — if a recovery is already in flight, skip.
let isRunning = false

/**
 * Recovers objects stuck in the "Publishing" state due to failed
 * publish-nodes batches.
 *
 * Strategy:
 * - Detects objects where some nodes are published but others are not
 *   (partial publishing — indicates a batch failure)
 * - For each stuck object, fetches only the unpublished node CIDs
 *   and re-publishes them via OnchainPublisher
 * - Limits throughput to avoid flooding the task queue
 *
 * Queue deferral (checking for pending pipeline tasks) is handled by
 * the job scheduler (publishingRecoveryJob.ts), NOT here. This ensures
 * that only timer-triggered runs defer, while task-triggered runs
 * always execute.
 */
const processPublishingRecovery = async (): Promise<void> => {
  if (isRunning) {
    logger.debug('Publishing recovery already in progress, skipping')
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
  const maxPerCycle = config.publishingRecovery.maxObjectsPerCycle

  const stuckRootCids = await nodesRepository.getStuckPublishingRootCids(
    maxPerCycle,
    config.publishingRecovery.stalenessThresholdBlocks,
  )

  if (stuckRootCids.length === 0) {
    logger.debug('No stuck publishing objects found, skipping')
    return
  }

  logger.info(
    'Found %d objects stuck in publishing, recovering',
    stuckRootCids.length,
  )

  for (const rootCid of stuckRootCids) {
    try {
      const unpublishedCids =
        await nodesRepository.getUnpublishedNodeCidsByRootCid(rootCid)

      if (unpublishedCids.length === 0) {
        // Race condition: nodes were published between detection and recovery
        logger.debug(
          'No unpublished nodes found for object (rootCid=%s), skipping',
          rootCid,
        )
        continue
      }

      logger.info(
        'Recovering %d unpublished nodes for object (rootCid=%s)',
        unpublishedCids.length,
        rootCid,
      )

      await OnchainPublisher.publishNodes(unpublishedCids)

      logger.info(
        'Successfully recovered publishing for object (rootCid=%s)',
        rootCid,
      )
    } catch (error) {
      logger.error(
        'Failed to recover publishing for object (rootCid=%s): %s',
        rootCid,
        error instanceof Error ? error.message : String(error),
      )
      // Continue with the next object — don't let one failure block others
    }
  }
}

export const PublishingRecoveryUseCases = {
  processPublishingRecovery,
}

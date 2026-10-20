import { nodesRepository } from '../../infrastructure/repositories/index.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { createTask } from '../../infrastructure/eventRouter/tasks.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { config } from '../../config.js'

const logger = createLogger('useCases:objects:publishingRecovery')

const PUBLISH_BATCH_SIZE = 50

// Concurrency guard — if a recovery is already in flight, skip.
let currentRun: symbol | null = null

/**
 * Recovers objects stuck in the "Publishing" state due to failed
 * publish-nodes batches.
 *
 * Strategy:
 * - Detects objects with publishable nodes left unpublished, either
 *   partially published or with no node published at all (every
 *   transaction of the first batch failed), retrying each at most
 *   once per retryCooldownMs
 * - For each stuck object, fetches only the unpublished node CIDs
 *   and enqueues them as batched publish-nodes tasks (same as the
 *   normal upload pipeline) so each batch gets independent retries
 *   and progress is preserved per-batch
 * - Limits throughput to avoid flooding the task queue
 *
 * Queue deferral (checking for pending pipeline tasks) is handled by
 * the job scheduler (publishingRecoveryJob.ts), NOT here. This ensures
 * that only timer-triggered runs defer, while task-triggered runs
 * always execute.
 */
const processPublishingRecovery = async (
  signal?: AbortSignal,
): Promise<void> => {
  signal?.throwIfAborted()
  if (currentRun !== null) {
    logger.debug('Publishing recovery already in progress, skipping')
    return
  }

  const runId = Symbol('publishingRecoveryRun')
  currentRun = runId
  const onAbort = () => {
    if (currentRun === runId) {
      currentRun = null
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await runRecoveryBatch(signal)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (currentRun === runId) {
      currentRun = null
    }
  }
}

const runRecoveryBatch = async (signal?: AbortSignal): Promise<void> => {
  const maxPerCycle = config.publishingRecovery.maxObjectsPerCycle

  // Surface objects that are stuck in an unrecoverable state — they have
  // unpublished nodes whose encoded_node was already stripped (e.g. by
  // archival before publishing completed).  These cannot be recovered
  // automatically and need operational attention.
  const unrecoverable =
    await nodesRepository.getUnrecoverablePublishingRootCids(maxPerCycle)
  signal?.throwIfAborted()
  if (unrecoverable.length > 0) {
    logger.warn(
      'Found %d objects with unrecoverable unpublished nodes (data stripped before publishing): %s',
      unrecoverable.length,
      unrecoverable
        .map((r) => `${r.root_cid} (${r.unrecoverable_count} nodes)`)
        .join(', '),
    )
  }

  const stuckRootCids = await nodesRepository.getStuckPublishingRootCids(
    maxPerCycle,
    config.publishingRecovery.stalenessThresholdBlocks,
    config.publishingRecovery.retryCooldownMs,
  )
  signal?.throwIfAborted()

  if (stuckRootCids.length === 0) {
    logger.debug('No stuck publishing objects found, skipping')
    return
  }

  logger.info(
    'Found %d objects stuck in publishing, recovering',
    stuckRootCids.length,
  )

  for (const rootCid of stuckRootCids) {
    signal?.throwIfAborted()
    try {
      const unpublishedCids =
        await nodesRepository.getUnpublishedNodeCidsByRootCid(rootCid)
      signal?.throwIfAborted()

      if (unpublishedCids.length === 0) {
        // Race condition: nodes were published between detection and recovery
        logger.debug(
          'No unpublished nodes found for object (rootCid=%s), skipping',
          rootCid,
        )
        continue
      }

      const batchCount = Math.ceil(unpublishedCids.length / PUBLISH_BATCH_SIZE)
      logger.info(
        'Enqueuing %d unpublished nodes in %d batches for object (rootCid=%s)',
        unpublishedCids.length,
        batchCount,
        rootCid,
      )

      // Check for abort before stamping cooldown to prevent delaying retries
      // when publishing tasks were never enqueued.
      signal?.throwIfAborted()

      // Start the retry cooldown before enqueuing: if the stamp failed after
      // the tasks went out, the next cycle would enqueue them all again.
      await nodesRepository.touchUnpublishedNodesByRootCid(rootCid)

      for (let i = 0; i < unpublishedCids.length; i += PUBLISH_BATCH_SIZE) {
        const batch = unpublishedCids.slice(i, i + PUBLISH_BATCH_SIZE)
        EventRouter.publish(
          createTask({ id: 'publish-nodes', params: { nodes: batch } }),
        )
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error
      }
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

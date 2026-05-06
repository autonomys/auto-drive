import {
  blake3HashFromCid,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { nodesRepository } from '../../infrastructure/repositories/index.js'
import { objectMappingIndexerClient } from '../../infrastructure/services/dsn/objectMappingIndexerClient/index.js'
import { ObjectUseCases } from './object.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { createTask } from '../../infrastructure/eventRouter/tasks.js'

const logger = createLogger('useCases:objects:reconciliation')

const BATCH_SIZE = 500

// Track consecutive zero-progress runs to detect permanently unresolvable
// nodes (the indexer also missed them and can't provide their data).
let consecutiveZeroProgressRuns = 0
const ZERO_PROGRESS_WARN_THRESHOLD = 3

// Concurrency guard — if a reconciliation is already in flight, skip.
// Prevents duplicate work when the setInterval tick overlaps with a
// self-rescheduled drain or when RabbitMQ prefetch delivers two tasks.
let isRunning = false

/**
 * Reconciles stuck nodes that have been published on-chain but are missing
 * piece_index/piece_offset from the indexer.
 *
 * Strategy:
 * - Fetches a batch of unreconciled nodes, ordered newest-first so newly
 *   uploaded objects are prioritized over legacy backlog
 * - Extracts blake3 hashes from CIDs and batch-queries the indexer
 * - Applies archival data for any nodes the indexer can resolve
 * - Triggers archival status check for affected objects (targeted, not N+1)
 * - If backlog remains AND progress was made: self-reschedules via
 *   RabbitMQ immediately (yields to other tasks in the queue between
 *   batches)
 * - If no progress was made or backlog is clear: returns without
 *   rescheduling. The periodic interval in the worker will enqueue
 *   the next run.
 */
const processReconciliation = async (): Promise<void> => {
  if (isRunning) {
    logger.debug('Reconciliation already in progress, skipping')
    return
  }

  isRunning = true
  try {
    await runReconciliationBatch()
  } finally {
    isRunning = false
  }
}

const runReconciliationBatch = async (): Promise<void> => {
  const unreconciledNodes = await nodesRepository.getUnreconciledNodes(
    BATCH_SIZE,
  )

  if (unreconciledNodes.length === 0) {
    logger.debug('No unreconciled nodes found, skipping')
    consecutiveZeroProgressRuns = 0
    return
  }

  logger.info(
    'Processing reconciliation batch of %d nodes',
    unreconciledNodes.length,
  )

  // Build CID → hash mapping
  const cidHashMap = new Map<string, string>()
  for (const node of unreconciledNodes) {
    try {
      const hash = Buffer.from(
        blake3HashFromCid(stringToCid(node.cid)),
      ).toString('hex')
      cidHashMap.set(node.cid, hash)
    } catch (error) {
      logger.warn(
        'Failed to extract blake3 hash from CID %s: %s',
        node.cid,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  if (cidHashMap.size === 0) {
    logger.warn('No valid hashes extracted from batch, skipping')
    return
  }

  // Build reverse map: hash → CID for matching results back
  const hashCidMap = new Map<string, string>()
  for (const [cid, hash] of cidHashMap) {
    hashCidMap.set(hash, cid)
  }

  // Build CID → head_cid map for tracking affected objects
  const cidHeadCidMap = new Map<string, string>(
    unreconciledNodes.map((n) => [n.cid, n.head_cid]),
  )

  const hashes = Array.from(cidHashMap.values())

  // Query indexer in sub-batches to avoid overwhelming it
  const SUB_BATCH_SIZE = 100
  let resolvedCount = 0
  const affectedHeadCids = new Set<string>()

  for (let i = 0; i < hashes.length; i += SUB_BATCH_SIZE) {
    const hashBatch = hashes.slice(i, i + SUB_BATCH_SIZE)

    const mappings =
      await objectMappingIndexerClient.getObjectMappings(hashBatch)

    // Apply resolved mappings
    for (const [hash, pieceIndex, pieceOffset] of mappings) {
      const cid = hashCidMap.get(hash)
      if (!cid) {
        continue
      }

      try {
        await nodesRepository.setNodeArchivingData({
          cid,
          pieceIndex,
          pieceOffset,
        })
        resolvedCount++

        // Track affected objects for archival status check
        const headCid = cidHeadCidMap.get(cid)
        if (headCid) {
          affectedHeadCids.add(headCid)
        }
      } catch (error) {
        logger.warn(
          'Failed to set archival data for node %s: %s',
          cid,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  logger.info(
    'Reconciliation batch complete: resolved %d/%d nodes, %d objects affected',
    resolvedCount,
    unreconciledNodes.length,
    affectedHeadCids.size,
  )

  // Check if any objects are now fully archived (targeted, single query)
  if (affectedHeadCids.size > 0) {
    await ObjectUseCases.checkArchivalStatusForObjects(
      Array.from(affectedHeadCids),
    )
  }

  // Track zero-progress runs to surface permanently unresolvable nodes
  if (resolvedCount === 0) {
    consecutiveZeroProgressRuns++
    if (consecutiveZeroProgressRuns >= ZERO_PROGRESS_WARN_THRESHOLD) {
      logger.error(
        'Reconciliation made no progress for %d consecutive runs. ' +
          '%d unreconciled nodes may be permanently unresolvable ' +
          '(indexer also missing their data). Consider indexer-side backfill.',
        consecutiveZeroProgressRuns,
        unreconciledNodes.length,
      )
    }
  } else {
    consecutiveZeroProgressRuns = 0
  }

  // Only reschedule immediately when the batch made progress. If zero
  // nodes were resolved the indexer is likely down or hasn't caught up,
  // and hammering it in a tight loop is wasteful. The periodic 5-minute
  // interval will restart the drain once the indexer recovers.
  if (resolvedCount > 0) {
    const remainingCount = await nodesRepository.getUnreconciledNodesCount()
    if (remainingCount > 0) {
      logger.info(
        'Rescheduling reconciliation, %d unreconciled nodes remaining',
        remainingCount,
      )
      EventRouter.publish(
        createTask({
          id: 'reconcile-archival',
          params: {},
        }),
      )
    }
  }
}

export const ReconciliationUseCases = {
  processReconciliation,
}

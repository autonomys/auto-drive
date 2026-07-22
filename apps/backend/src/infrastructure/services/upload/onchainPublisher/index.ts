import { createLogger } from '../../../drivers/logger.js'
import { NodesUseCases } from '../../../../core/objects/nodes.js'
import { createTransactionManager } from './transactionManager.js'
import { compactAddLength } from '@polkadot/util'
import { nodesRepository } from '../../../repositories/objects/nodes.js'

const logger = createLogger('upload:onchainPublisher')

export const transactionManager = createTransactionManager()

const publishNodes = async (cids: string[]) => {
  logger.info('Uploading %d nodes', cids.length)

  const nodes = await nodesRepository.getNodesByCids(cids)

  // Optimize: Batch-check which CIDs are already published anywhere in the table
  // We consider a node "repeated" if there exists ANY row with the same CID that has blockchain data
  const uniqueCids = Array.from(new Set(nodes.map((n) => n.cid)))
  const publishedRows =
    await nodesRepository.getNodesBlockchainDataBatch(uniqueCids)
  const publishedCidSet = new Set(publishedRows.map((r) => r.cid))

  const repeatedNodes = nodes.filter((node) => publishedCidSet.has(node.cid))
  await NodesUseCases.handleRepeatedNodes(repeatedNodes)

  // Nodes that are not known as published anywhere should be sent for publishing.
  // Filter out nodes whose encoded_node has been removed (e.g. after archival) —
  // these are un-publishable and must not reach the Buffer.from() call.
  const publishingNodes = nodes.filter(
    (node) => !publishedCidSet.has(node.cid) && node.encoded_node != null,
  )

  const skippedNullCount = nodes.filter(
    (node) => !publishedCidSet.has(node.cid) && node.encoded_node == null,
  ).length
  if (skippedNullCount > 0) {
    logger.warn(
      'Skipped %d nodes with NULL encoded_node (archived before publishing)',
      skippedNullCount,
    )
  }

  if (publishingNodes.length === 0) {
    logger.info('No publishable nodes remaining after filtering')
    return
  }

  const transactions = publishingNodes.map((node) => {
    const buffer = Buffer.from(node.encoded_node!, 'base64')

    return {
      module: 'system',
      method: 'remark',
      params: [compactAddLength(buffer)],
    }
  })

  logger.debug(
    'Submitting %d transaction(s) to publish (unique cids=%d, repeated=%d, skipped-null=%d)',
    transactions.length,
    uniqueCids.length,
    repeatedNodes.length,
    skippedNullCount,
  )

  const results = await transactionManager.submit(transactions)

  // Summarise the batch by success + status so the reason a publish attempt
  // failed is visible in one line rather than by correlating N per-tx traces:
  // e.g. all `fail:Timeout` points at the confirmation-depth livelock (target
  // never reached before timeout), `fail:Reorged` at chain instability, and
  // `fail:Invalid` at a signer/balance fault. Objects stay in "publishing"
  // whenever this batch throws, so this is the breadcrumb that explains it.
  const statusBreakdown = results.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.success ? 'ok' : 'fail'}:${r.status}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  logger.debug(
    'Publishing batch settled: %d/%d succeeded — status breakdown %o',
    results.filter((r) => r.success).length,
    results.length,
    statusBreakdown,
  )

  const someNodeFailed = results.some((result) => !result.success)
  if (someNodeFailed) {
    // Surface the breakdown at warn too: a bare "Failed to publish nodes" gives
    // no clue why an object won't leave the publishing state.
    logger.warn(
      'Failed to publish %d/%d nodes — status breakdown %o',
      results.filter((r) => !r.success).length,
      results.length,
      statusBreakdown,
    )
    throw new Error(
      `Failed to publish nodes (${JSON.stringify(statusBreakdown)})`,
    )
  }

  await Promise.all(
    publishingNodes.map((node, index) => {
      const isSuccess = results[index].success
      if (!isSuccess) return null
      return NodesUseCases.setPublishedOn(node.cid, results[index])
    }),
  )
}

export const OnchainPublisher = {
  publishNodes,
}

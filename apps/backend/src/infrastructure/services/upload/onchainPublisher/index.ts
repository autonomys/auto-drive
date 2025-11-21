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

  // Nodes that are not known as published anywhere should be sent for publishing
  const publishingNodes = nodes.filter((node) => !publishedCidSet.has(node.cid))

  const transactions = publishingNodes.map((node) => {
    const buffer = Buffer.from(node.encoded_node, 'base64')

    return {
      module: 'system',
      method: 'remark',
      params: [compactAddLength(buffer)],
    }
  })

  const results = await transactionManager.submit(transactions)
  const someNodeFailed = results.some((result) => !result.success)
  if (someNodeFailed) {
    throw new Error('Failed to publish nodes')
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

import { createLogger } from '../../../drivers/logger.js'
import { NodesUseCases } from '../../../../core/objects/nodes.js'
import { createTransactionManager } from './transactionManager.js'
import { compactAddLength } from '@polkadot/util'
import { nodesRepository, Node } from '../../../repositories/objects/nodes.js'

const logger = createLogger('upload:onchainPublisher')

export const transactionManager = createTransactionManager()

const publishNodes = async (cids: string[]) => {
  logger.info('Uploading %d nodes', cids.length)

  const nodes = await nodesRepository.getNodesByCids(cids)
  const nodeCounts = await Promise.all(
    nodes.map((e) =>
      nodesRepository.getNodeCount({
        cid: e.cid,
      }),
    ),
  )

  const filter = (node: Node, index: number) => {
    return nodeCounts[index] && (nodeCounts[index].publishedCount ?? 0) === 0
  }

  const repeatedNodes = nodes.filter((_, index) => !filter(_, index))
  await NodesUseCases.handleRepeatedNodes(repeatedNodes)

  const publishingNodes = nodes.filter(filter)

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

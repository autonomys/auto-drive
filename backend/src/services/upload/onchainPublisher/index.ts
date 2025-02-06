import { logger } from '../../../drivers/logger.js'
import { TransactionResultsUseCases } from '../../../useCases/index.js'
import { safeCallback } from '../../../utils/safe.js'
import { createTransactionManager } from './transactionManager.js'
import { compactAddLength } from '@polkadot/util'
import { nodesRepository } from '../../../repositories/objects/nodes.js'
import { TaskManager } from '../../taskManager/index.js'

const transactionManager = createTransactionManager()

const publishNodes = safeCallback(async (cids: string[]) => {
  logger.info(`Uploading ${cids.length} nodes`)

  const nodes = await nodesRepository.getNodesByCids(cids)

  const transactions = nodes.map((node) => {
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
    await republishNodes(
      nodes
        .filter((_, index) => !results[index].success)
        .map((node) => node.cid),
    )
  }

  await Promise.all(
    nodes.map((node, index) => {
      const isSuccess = results[index].success
      if (!isSuccess) return null
      return TransactionResultsUseCases.setTransactionResults(
        node.cid,
        results[index],
      )
    }),
  )
})

const republishNodes = safeCallback(async (nodes: string[]) => {
  TaskManager.publish({
    id: 'publish-nodes',
    params: {
      nodes,
    },
  })
})

export const OnchainPublisher = {
  publishNodes,
}

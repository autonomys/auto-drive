import { logger } from '../../../drivers/logger.js'
import { NodesUseCases } from '../../../useCases/index.js'
import { safeCallback } from '../../../utils/safe.js'
import { createTransactionManager } from './transactionManager.js'
import { compactAddLength } from '@polkadot/util'
import { nodesRepository } from '../../../repositories/objects/nodes.js'
import { TaskManager } from '../../taskManager/index.js'

export const transactionManager = createTransactionManager()

const REPUBLISH_DELAY = 10_000

const publishNodes = safeCallback(
  async (cids: string[], retriesLeft: number) => {
    logger.info(`Uploading ${cids.length} nodes`)

    const nodes = await nodesRepository.getNodesByCids(cids)
    const nodeCounts = await Promise.all(
      nodes.map((e) =>
        nodesRepository.getNodeCount({
          cid: e.cid,
        }),
      ),
    )

    const filteredNodes = nodes.filter(
      (_, index) => nodeCounts[index].totalCount === 0,
    )

    const transactions = filteredNodes.map((node) => {
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
      republishNodes(
        filteredNodes
          .filter((_, index) => !results[index].success)
          .map((node) => node.cid),
        retriesLeft,
      )
    }

    await Promise.all(
      filteredNodes.map((node, index) => {
        const isSuccess = results[index].success
        if (!isSuccess) return null
        return NodesUseCases.setPublishedOn(node.cid, results[index])
      }),
    )
  },
)

const republishNodes = safeCallback(
  async (nodes: string[], retriesLeft: number) => {
    await new Promise((resolve) => setTimeout(resolve, REPUBLISH_DELAY))
    if (retriesLeft > 0) {
      TaskManager.publish({
        id: 'publish-nodes',
        retriesLeft: retriesLeft - 1,
        params: {
          nodes,
        },
      })
    }
  },
)

export const OnchainPublisher = {
  publishNodes,
}

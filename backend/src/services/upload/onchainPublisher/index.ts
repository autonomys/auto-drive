import { logger } from '../../../drivers/logger.js'
import { TransactionResultsUseCases } from '../../../useCases/index.js'
import { safeCallback } from '../../../utils/safe.js'
import { createTransactionManager } from './transactionManager.js'
import { compactAddLength } from '@polkadot/util'
import { nodesRepository } from '../../../repositories/objects/nodes.js'

const transactionManager = createTransactionManager()

const publishNodes = safeCallback(async (cids: string[]) => {
  try {
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

    await Promise.all(
      nodes.map((node, index) =>
        TransactionResultsUseCases.setTransactionResults(
          node.cid,
          results[index],
        ),
      ),
    )
  } catch (error) {
    console.error(error)
  }
})

export const OnchainPublisher = {
  publishNodes,
}

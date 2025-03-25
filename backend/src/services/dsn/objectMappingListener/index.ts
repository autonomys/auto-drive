import { z } from 'zod'
import { ObjectMappingListEntrySchema } from '@auto-drive/models'
import { NodesUseCases } from '../../../useCases/index.js'
import { config } from '../../../config.js'
import { logger } from '../../../drivers/logger.js'
import { nodesRepository } from '../../../repositories/index.js'
import { createRpcClient } from '@autonomys/rpc'

type RpcClient = ReturnType<typeof createRpcClient>

const start = async () => {
  const ws = createRpcClient({
    endpoint: config.objectMappingArchiver.url,
    reconnectInterval: 1_000,
    callbacks: {
      onReconnection: () => initSubscription(ws),
      onOpen: () => initSubscription(ws),
    },
  })

  ws.on(async (message) => {
    const { data, success } = z
      .object({
        subscriptionId: z.string(),
        result: ObjectMappingListEntrySchema,
      })
      .safeParse(message)

    if (!success) {
      console.error('Failed to parse object mapping list entry', data)
      return
    }

    if (data.result.v0.objects.length > 0) {
      logger.info(
        `Processing object mapping list entry of length ${data.result.v0.objects.length}`,
      )
      await NodesUseCases.scheduleNodeArchiving(data.result.v0.objects)
    }
  })
}

const initSubscription = async (ws: RpcClient) => {
  const SAFE_BLOCK_NUMBER_THRESHOLD = 100
  const node = await nodesRepository.getFirstNotArchivedNode()

  if (!node?.block_published_on) {
    logger.info('Subscribing to real time object mappings')
    await ws.send({
      jsonrpc: '2.0',
      method: 'subscribe_object_mappings',
    })
  } else {
    const blockNumber = node.block_published_on
    logger.info(`Subscribing to recover object mappings from ${blockNumber}`)
    await ws.send({
      jsonrpc: '2.0',
      method: 'subscribe_recover_object_mappings',
      params: {
        blockNumber: blockNumber - SAFE_BLOCK_NUMBER_THRESHOLD,
      },
    })
  }
}

export const objectMappingArchiver = {
  start,
}

import { z } from 'zod'
import { ObjectMappingListEntrySchema } from '@auto-drive/models'
import { NodesUseCases } from '../../../useCases/index.js'
import { config } from '../../../config.js'
import { logger } from '../../../drivers/logger.js'
import { nodesRepository } from '../../../repositories/index.js'
import { ApiClientType } from '@autonomys/rpc'
import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'

type ObjectMappingIndexerRpcClient = ReturnType<
  typeof ObjectMappingIndexerRPCApi.createClient
>

const start = async () => {
  const initSubscription = async (client: ObjectMappingIndexerRpcClient) => {
    const node = await nodesRepository.getLastArchivedPieceNode()

    const pieceIndex = node?.piece_index ?? 0

    logger.info(
      `Subscribing to recover object mappings from piece ${pieceIndex}`,
    )
    await client.api.subscribe_recover_object_mappings({
      pieceIndex,
    })
  }

  const ws = ObjectMappingIndexerRPCApi.createClient({
    endpoint: config.objectMappingArchiver.url,
    reconnectInterval: 1_000,
    callbacks: {
      onReconnection: () => {
        initSubscription(ws)
      },
      onOpen: () => {
        initSubscription(ws)
      },
    },
  })

  ws.onNotification('object_mapping_list', async (message) => {
    if (message.length > 0) {
      logger.info(
        `Processing object mapping list entry of length ${message.length}`,
      )
      await NodesUseCases.scheduleNodeArchiving(message)
    }
  })
}

export const objectMappingArchiver = {
  start,
}

import { NodesUseCases } from '../../../useCases/index.js'
import { config } from '../../../config.js'
import { createLogger } from '../../../drivers/logger.js'
import { nodesRepository } from '../../../repositories/index.js'
import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'

const logger = createLogger('dsn:objectMappingListener')

type ObjectMappingIndexerRpcClient = ReturnType<
  typeof ObjectMappingIndexerRPCApi.createClient
>

const ONE_MINUTE = 60_000

const start = async () => {
  const initSubscription = async (client: ObjectMappingIndexerRpcClient) => {
    const node = await nodesRepository.getLastArchivedPieceNode()

    const pieceIndex = node?.piece_index ?? 0

    logger.info(
      'Subscribing to recover object mappings from piece %d',
      pieceIndex,
    )

    // To be properly solved later
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client.api as any).subscribe_recover_object_mappings({
      pieceIndex,
      step: config.objectMappingArchiver.step,
    })
  }

  const ws = ObjectMappingIndexerRPCApi.createClient({
    endpoint: config.objectMappingArchiver.url,
    reconnectInterval: ONE_MINUTE,
    callbacks: {
      onEveryOpen: () => {
        logger.info('Connected to object mapping archiver')
        initSubscription(ws)
      },
      onReconnection: () => {
        logger.debug('Reconnected to object mapping archiver')
      },
      onClose: () => {
        logger.debug('Closed connection to object mapping archiver')
      },
    },
  })

  ws.onNotification('object_mapping_list', async (message) => {
    logger.debug('Received object mapping list', message)
    if (message.length > 0) {
      logger.info(
        'Processing object mapping list entry of length %d',
        message.length,
      )
      await NodesUseCases.scheduleNodeArchiving(message)
    }
  })
}

export const objectMappingArchiver = {
  start,
}

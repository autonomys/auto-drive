import { z } from 'zod'
import { createWS } from '../../drivers/ws.js'
import { ObjectMappingListEntrySchema } from '../../models/objects/objectMappings.js'
import { NodesUseCases } from '../../useCases/index.js'
import { transactionResultsRepository } from '../../repositories/index.js'

const start = async () => {
  const url = process.env.OBJECT_MAPPING_ARCHIVER_URL
  if (!url) {
    throw new Error('OBJECT_MAPPING_ARCHIVER_URL is not set')
  }

  const ws = createWS(url)

  const blockNumber =
    await transactionResultsRepository.getFirstNotArchivedNode()

  if (!blockNumber) {
    console.log('Subscribing to object mappings')
    await ws.send({
      jsonrpc: '2.0',
      method: 'subscribe_object_mappings',
    })
  } else {
    console.log('Subscribing to recover object mappings')
    await ws.send({
      jsonrpc: '2.0',
      method: 'subscribe_recover_object_mappings',
      params: {
        blockNumber,
      },
    })
  }

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
      console.log(
        `Processing object mapping list entry of length ${data.result.v0.objects.length}`,
      )
      await NodesUseCases.processNodeArchived(data.result)
    }
  })
}

export const objectMappingArchiver = {
  start,
}

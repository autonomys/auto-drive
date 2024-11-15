import { z } from 'zod'
import { createWS } from '../../drivers/ws.js'
import { ObjectMappingListEntrySchema } from '../../models/objects/ObjectMapping.js'
import { NodesUseCases } from '../../useCases/index.js'

const start = async () => {
  const url = process.env.OBJECT_MAPPING_ARCHIVER_URL
  if (!url) {
    throw new Error('OBJECT_MAPPING_ARCHIVER_URL is not set')
  }

  const ws = createWS(url)

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

  await ws.send({
    jsonrpc: '2.0',
    method: 'subscribe_recover_object_mappings',
    params: {
      blockNumber: 0,
    },
  })
}

export const objectMappingArchiver = {
  start,
}

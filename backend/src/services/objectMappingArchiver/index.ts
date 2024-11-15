import { createWS } from '../../drivers/ws.js'

const start = () => {
  const url = process.env.OBJECT_MAPPING_ARCHIVER_URL
  if (!url) {
    throw new Error('OBJECT_MAPPING_ARCHIVER_URL is not set')
  }

  const ws = createWS(url)

  ws.on((message) => {
    console.log(
      `Object mapping archiver message with method: ${JSON.stringify(message)}`,
    )
  })

  ws.send({
    jsonrpc: '2.0',
    method: 'subscribe_object_mappings',
    params: {
      blockNumber: 0,
    },
  })
}

export const objectMappingArchiver = {
  start,
}

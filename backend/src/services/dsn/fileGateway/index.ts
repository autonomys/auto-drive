import { config } from '../../../config'

const downloadFile = async function* (cid: string): AsyncIterable<Buffer> {
  const response = await fetch(`${config.filesGateway}/files/${cid}`, {
    headers: {
      Authorization: `Bearer ${config.filesGatewayToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to download file')
  }

  if (response.body === null) {
    throw new Error('File not found')
  }

  for await (const chunk of response.body) {
    yield Buffer.from(chunk)
  }
}

export const FileGateway = {
  downloadFile,
}

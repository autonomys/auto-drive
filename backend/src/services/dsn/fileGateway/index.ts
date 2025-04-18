import { AwaitIterable } from 'interface-store'
import { config } from '../../../config.js'

const downloadFile = async (
  cid: string,
): Promise<AwaitIterable<Uint8Array>> => {
  const response = await fetch(
    `${config.filesGateway.url}/files/${cid}?api_key=${config.filesGateway.token}&raw=true`,
  )

  if (!response.ok) {
    throw new Error(`Error fetching file: ${response.statusText}`)
  }

  if (!response.body) return []

  return response.body
}

export const FileGateway = {
  downloadFile,
}

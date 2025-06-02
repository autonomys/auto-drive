import { config } from '../../../config.js'
import { Readable } from 'stream'

const downloadFile = async (cid: string): Promise<Readable> => {
  const response = await fetch(
    `${config.filesGateway.url}/files/${cid}?api_key=${config.filesGateway.token}&raw=true`,
  )

  if (!response.ok) {
    throw new Error(`Error fetching file: ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('No body')
  }

  return Readable.from(response.body)
}

export const FileGateway = {
  downloadFile,
}

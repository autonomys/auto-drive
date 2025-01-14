import { config } from '../../../config.js'
import { request } from 'https'

const downloadFile = async (cid: string): Promise<AsyncIterable<Buffer>> => {
  const req = request(
    `${config.filesGateway}/files/${cid}?api_key=${config.filesGatewayToken}`,
  )

  req.end()

  return new Promise((resolve, reject) => {
    req.on('response', (res) => {
      resolve(res)
    })

    req.on('error', (err) => {
      reject(err)
    })
  })
}

export const FileGateway = {
  downloadFile,
}

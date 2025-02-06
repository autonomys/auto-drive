import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { Response } from 'express'

export const handleDownloadResponseHeaders = (
  res: Response,
  metadata: OffchainMetadata,
) => {
  const safeName = encodeURIComponent(metadata.name || 'download')

  if (metadata.type === 'file') {
    res.set('Content-Type', metadata.mimeType || 'application/octet-stream')
    res.set('Content-Disposition', `filename="${safeName}"`)
    const compressedButNoEncrypted =
      metadata.uploadOptions?.compression && !metadata.uploadOptions?.encryption
    if (compressedButNoEncrypted) {
      res.set('Content-Encoding', 'deflate')
    }
    res.set('Content-Length', metadata.totalSize.toString())
  } else {
    res.set('Content-Type', 'application/zip')
    res.set('Content-Disposition', `filename="${safeName}.zip"`)
  }
}

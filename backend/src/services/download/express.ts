import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { Response, Request } from 'express'

export const handleDownloadResponseHeaders = (
  req: Request,
  res: Response,
  metadata: OffchainMetadata,
) => {
  const safeName = encodeURIComponent(metadata.name || 'download')
  const isExpectedDocument =
    req.headers['sec-fetch-dest'] === 'document' ||
    req.headers['sec-fetch-dest'] === 'iframe'

  if (metadata.type === 'file') {
    res.set('Content-Type', metadata.mimeType || 'application/octet-stream')
    res.set(
      'Content-Disposition',
      `filename="${safeName}"; ${isExpectedDocument ? 'inline' : 'attachment'}`,
    )
    const compressedButNoEncrypted =
      metadata.uploadOptions?.compression && !metadata.uploadOptions?.encryption
    if (compressedButNoEncrypted && isExpectedDocument) {
      res.set('Content-Encoding', 'deflate')
    }
    res.set('Content-Length', metadata.totalSize.toString())
  } else {
    res.set('Content-Type', 'application/zip')
    res.set(
      'Content-Disposition',
      `filename="${safeName}.zip; ${isExpectedDocument ? 'inline' : 'attachment'}`,
    )
  }
}

import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { Response, Request } from 'express'

export const handleDownloadResponseHeaders = (
  req: Request,
  res: Response,
  metadata: OffchainMetadata,
) => {
  const safeName = encodeURIComponent(metadata.name || 'download')
  const isExpectedDocument =
    req.headers['sec-fetch-site'] === 'none' ||
    (req.headers['sec-fetch-site'] === 'same-site' &&
      req.headers['sec-fetch-mode'] === 'navigate')

  const shouldHandleEncoding = req.query.ignoreEncoding
    ? req.query.ignoreEncoding !== 'true'
    : isExpectedDocument

  const isEncrypted = !!metadata.uploadOptions?.encryption?.algorithm
  if (metadata.type === 'file') {
    const contentType =
      (!isEncrypted && metadata.mimeType) || 'application/octet-stream'
    res.set('Content-Type', contentType)
    res.set(
      'Content-Disposition',
      `filename="${safeName}"; ${isExpectedDocument ? 'inline' : 'attachment'}`,
    )
    const compressedButNoEncrypted =
      metadata.uploadOptions?.compression && !metadata.uploadOptions?.encryption
    if (compressedButNoEncrypted && shouldHandleEncoding) {
      res.set('Content-Encoding', 'deflate')
    }
    res.set('Content-Length', metadata.totalSize.toString())
  } else {
    const contentType = isEncrypted
      ? 'application/octet-stream'
      : 'application/zip'
    res.set('Content-Type', contentType)
    res.set(
      'Content-Disposition',
      `filename="${safeName}.zip; ${isExpectedDocument ? 'inline' : 'attachment'}`,
    )
  }
}

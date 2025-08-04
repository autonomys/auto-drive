import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { ByteRange } from '@autonomys/file-caching'
import { Response, Request } from 'express'

const isExpectedDocument = (req: Request) => {
  return (
    req.headers['sec-fetch-site'] === 'none' ||
    (req.headers['sec-fetch-site'] === 'same-site' &&
      req.headers['sec-fetch-mode'] === 'navigate')
  )
}

export const handleDownloadResponseHeaders = (
  req: Request,
  res: Response,
  metadata: OffchainMetadata,
  byteRange: ByteRange | undefined,
) => {
  const safeName = encodeURIComponent(metadata.name || 'download')
  const documentExpected = isExpectedDocument(req)
  const shouldHandleEncoding = req.query.ignoreEncoding
    ? req.query.ignoreEncoding !== 'true'
    : documentExpected

  const isEncrypted = !!metadata.uploadOptions?.encryption?.algorithm
  if (metadata.type === 'file') {
    setFileResponseHeaders(
      res,
      metadata,
      isEncrypted,
      documentExpected,
      shouldHandleEncoding,
      safeName,
      byteRange,
    )
  } else {
    setFolderResponseHeaders(res, isEncrypted, documentExpected, safeName)
  }
}

const setFileResponseHeaders = (
  res: Response,
  metadata: OffchainMetadata & { type: 'file' },
  isEncrypted: boolean,
  isExpectedDocument: boolean,
  shouldHandleEncoding: boolean,
  safeName: string,
  byteRange: ByteRange | undefined,
) => {
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

  if (byteRange) {
    res.status(206)
    res.set(
      'Content-Range',
      `bytes ${byteRange[0]}-${byteRange[1]}/${metadata.totalSize}`,
    )
    const upperBound = byteRange[1] ?? Number(metadata.totalSize)
    res.set('Content-Length', (upperBound - byteRange[0] + 1).toString())
  } else {
    res.set('Content-Length', metadata.totalSize.toString())
  }
}

const setFolderResponseHeaders = (
  res: Response,
  isEncrypted: boolean,
  isExpectedDocument: boolean,
  safeName: string,
) => {
  const contentType = isEncrypted
    ? 'application/octet-stream'
    : 'application/zip'
  res.set('Content-Type', contentType)
  res.set(
    'Content-Disposition',
    `filename="${safeName}.zip; ${isExpectedDocument ? 'inline' : 'attachment'}`,
  )
}

export const handleS3DownloadResponseHeaders = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  req: Request,
  res: Response,
  metadata: OffchainMetadata,
) => {
  const isEncrypted = !!metadata.uploadOptions?.encryption?.algorithm
  if (isEncrypted) {
    res.set(
      'x-amz-meta-encryption',
      metadata.uploadOptions?.encryption?.algorithm,
    )
  }

  const isCompressed = !!metadata.uploadOptions?.compression?.algorithm
  if (isCompressed) {
    res.set(
      'x-amz-meta-compression',
      metadata.uploadOptions?.compression?.algorithm,
    )
  }
}

import { Request } from 'express'
import { ByteRange } from '@autonomys/file-caching'

export const getByteRange = (req: Request): ByteRange | undefined => {
  const byteRange = req.headers['content-range']
  if (byteRange == null) {
    return undefined
  }
  const header = 'bytes '

  const [start, end] = byteRange.slice(header.length).split('-')
  const startNumber = Number(start)
  const endNumber = end && end !== '*' ? Number(end) : undefined
  return [startNumber, endNumber]
}

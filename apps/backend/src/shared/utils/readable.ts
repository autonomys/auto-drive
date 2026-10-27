import { Readable } from 'stream'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('utils:readable')

/**
 * Attach a defensive 'error' handler to a Readable stream to prevent
 * unhandled error events from crashing the process. Returns the same stream.
 */
export const handleReadableError = (
  stream: Readable | AsyncIterable<Buffer>,
  message: string,
  ...params: unknown[]
) => {
  if (stream instanceof Readable) {
    stream.on('error', (error) => {
      // Message first, error LAST. This logger is debug-level, not pino: its
      // formatter treats a leading Error as the message itself and then appends
      // the real format string verbatim, so `warn(error, 'cid=%s', cid)` emitted
      // a literal `%s` next to an unlabelled CID. Diagnosing issue #815 cost
      // real time to that — the CID in those lines is the object's first chunk,
      // not the chunk that failed, and the `%s` made the two easy to conflate.
      // With the string first the placeholders substitute, and a trailing Error
      // is still picked up and attached as the structured `err` field.
      logger.warn(message, ...params, error)
    })
  }
  return stream
}

export const createEmptyReadable = (): Readable => {
  return new Readable({
    read() {
      this.push(null)
    },
  })
}

import { Readable, Transform, pipeline } from 'stream'
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

/**
 * Pass `source` through a stream that fails with `message`, and destroys
 * `source`, once `timeoutMs` go by without a chunk. The clock starts at the
 * first chunk, so a slow start is never cut short. A consumer that stops
 * reading also stops the chunks, so it counts as inactivity too.
 */
export const withInactivityTimeout = (
  source: Readable,
  timeoutMs: number,
  message: string,
): Readable => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guarded = new Transform({
    transform(chunk, _encoding, callback) {
      clearTimeout(timer)
      timer = setTimeout(() => guarded.destroy(new Error(message)), timeoutMs)
      callback(null, chunk)
    },
    flush(callback) {
      clearTimeout(timer)
      callback()
    },
    destroy(error, callback) {
      clearTimeout(timer)
      callback(error)
    },
  })
  // Errors reach the caller through `guarded`, which pipeline destroys with them.
  pipeline(source, guarded, () => {})
  return guarded
}

export const createEmptyReadable = (): Readable => {
  return new Readable({
    read() {
      this.push(null)
    },
  })
}

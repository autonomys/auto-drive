import { PassThrough, Readable } from 'stream'
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
      logger.warn(error as Error, message, ...params)
    })
  }
  return stream
}

export const sliceReadable = async (
  readable: Readable,
  start: number,
  length: number,
): Promise<Readable> => {
  logger.info('sliceReadable called (start=%s, length=%s)', start, length)
  return new Promise<Readable>((resolve, reject) => {
    let bytesRead = 0
    let bytesPushed = 0
    let cleanedUp = false
    const pass = new PassThrough()

    // Helper to clean up all listeners to prevent memory leaks.
    // Uses a flag to prevent double-cleanup in edge cases.
    function cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      readable.removeListener('data', onData)
      readable.removeListener('end', onEnd)
      readable.removeListener('error', onError)
    }

    function onData(chunk: Buffer) {
      logger.info(
        'onData called (bytesRead=%s, start=%s, length=%s)',
        bytesRead,
        start,
        length,
      )
      let chunkStart = 0
      const chunkEnd = chunk.length

      // If we haven't reached the start, skip bytes
      if (bytesRead < start) {
        const skip = Math.min(start - bytesRead, chunk.length)
        bytesRead += skip
        chunkStart += skip
        if (chunkStart >= chunkEnd) {
          // All of this chunk is before start, skip it
          return
        }
      }

      // Now, bytesRead >= start
      // Figure out how many bytes to push from this chunk
      const remaining = length - bytesPushed
      const available = chunkEnd - chunkStart
      const toPush = Math.min(remaining, available)

      if (toPush > 0) {
        pass.write(chunk.slice(chunkStart, chunkStart + toPush))
        bytesPushed += toPush
        bytesRead += toPush
        chunkStart += toPush
      }

      // If we've pushed enough, end the stream
      if (bytesPushed >= length) {
        cleanup()
        pass.end()
      } else {
        // If there are leftover bytes in the chunk, but we only needed part of it, update bytesRead
        if (chunkStart < chunkEnd) {
          bytesRead += chunkEnd - chunkStart
        }
      }
    }

    function onEnd() {
      cleanup()
      pass.end()
    }

    function onError(err: Error) {
      cleanup()
      pass.destroy(err)
      reject(err)
    }

    readable.on('data', onData)
    readable.once('end', onEnd)   // Use .once() - end fires at most once
    readable.once('error', onError) // Use .once() - error fires at most once

    // If the readable is already ended, resolve immediately
    pass.on('close', () => {
      resolve(pass)
    })
    // In case the stream is synchronous and ends before we attach 'close'
    setImmediate(() => resolve(pass))
  })
}

export const createEmptyReadable = (): Readable => {
  return new Readable({
    read() {
      this.push(null)
    },
  })
}

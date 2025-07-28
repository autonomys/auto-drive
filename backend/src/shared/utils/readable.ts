import { PassThrough, Readable } from 'stream'
import { createLogger } from '../../infrastructure/drivers/logger.js'

const logger = createLogger('utils:readable')

export const sliceReadable = async (
  readable: Readable,
  start: number,
  length: number,
): Promise<Readable> => {
  logger.info('sliceReadable called (start=%s, length=%s)', start, length)
  return new Promise<Readable>((resolve, reject) => {
    let bytesRead = 0
    let bytesPushed = 0
    const pass = new PassThrough()

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
        readable.removeListener('data', onData)
        readable.removeListener('end', onEnd)
        readable.removeListener('error', onError)
        pass.end()
      } else {
        // If there are leftover bytes in the chunk, but we only needed part of it, update bytesRead
        if (chunkStart < chunkEnd) {
          bytesRead += chunkEnd - chunkStart
        }
      }
    }

    function onEnd() {
      pass.end()
    }

    function onError(err: Error) {
      pass.destroy(err)
      reject(err)
    }

    readable.on('data', onData)
    readable.once('end', onEnd)
    readable.once('error', onError)

    // If the readable is already ended, resolve immediately
    pass.on('close', () => {
      resolve(pass)
    })
    // In case the stream is synchronous and ends before we attach 'close'
    setImmediate(() => resolve(pass))
  })
}

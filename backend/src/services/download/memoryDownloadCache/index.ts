import { LRUCache } from 'lru-cache'
import {
  asyncIterableToBuffer,
  bufferToAsyncIterable,
} from '@autonomys/asynchronous'
import { AwaitIterable } from 'interface-store'
import { config } from '../../../config.js'
import { DownloadServiceOptions } from '@auto-drive/models'

const cache = new LRUCache<string, Buffer>({
  maxSize: config.memoryDownloadCache.maxCacheSize,
})

const has = (cid: string) => {
  const has = cache.has(cid)
  return has
}

const get = (cid: string, options?: DownloadServiceOptions) => {
  const value = cache.get(cid)
  if (!value) {
    return null
  }

  const byteRange = options?.byteRange ?? [0, value.length - 1]

  return bufferToAsyncIterable(
    Buffer.from(
      value.buffer.slice(
        byteRange[0],
        byteRange[1] !== undefined ? byteRange[1] + 1 : undefined,
      ),
    ),
  )
}

const set = async (
  cid: string,
  value: AwaitIterable<Buffer>,
): Promise<void> => {
  const buffer = await asyncIterableToBuffer(value)

  if (buffer.length > 0) {
    cache.set(cid, buffer, {
      sizeCalculation: (value) => value.length,
    })
  }
}

export const clear = async () => cache.clear()

export const memoryDownloadCache = {
  has,
  get,
  set,
  clear,
}

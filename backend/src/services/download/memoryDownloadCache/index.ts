import { LRUCache } from 'lru-cache'
import {
  asyncIterableToBuffer,
  bufferToAsyncIterable,
} from '../../../utils/async.js'
import { AwaitIterable } from 'interface-store'
import { config } from '../../../config.js'

const cache = new LRUCache<string, Buffer>({
  maxSize: config.memoryDownloadCache.maxCacheSize,
})

const has = (cid: string) => {
  const has = cache.has(cid)
  return has
}

const get = (cid: string) => {
  const value = cache.get(cid)
  if (!value) {
    return null
  }

  return bufferToAsyncIterable(value)
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

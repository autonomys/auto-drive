import { LRUCache } from 'lru-cache'
import { bufferToAsyncIterable } from '../../../utils/async.js'
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

const set = async function* (
  cid: string,
  value: AwaitIterable<Buffer>,
): AsyncIterable<Buffer> {
  let buffer = Buffer.alloc(0)
  for await (const chunk of value) {
    buffer = Buffer.concat([buffer, chunk])
    yield chunk
  }

  if (buffer.length > 0) {
    cache.set(cid, buffer, {
      sizeCalculation: (value) => value.length,
    })
  }
}

export const memoryDownloadCache = {
  has,
  get,
  set,
}

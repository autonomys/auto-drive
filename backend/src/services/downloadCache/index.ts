import { LRUCache } from 'lru-cache'
import { bufferToAsyncIterable } from '../../utils/async.js'

const ONE_GB = 1024 ** 3

const cache = new LRUCache<string, Buffer>({
  maxSize: Number(process.env.MAX_CACHE_SIZE ?? ONE_GB),
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
  value: AsyncIterable<Buffer>,
): AsyncIterable<Buffer> {
  let buffer = Buffer.alloc(0)
  for await (const chunk of value) {
    buffer = Buffer.concat([buffer, chunk])
    yield chunk
  }
  cache.set(cid, buffer, {
    sizeCalculation: (value) => value.length,
  })
}

export const downloadCache = {
  has,
  get,
  set,
}

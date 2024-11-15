import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, Buffer>({
  maxSize: Number(process.env.MAX_CACHE_SIZE),
})

const has = (cid: string) => cache.has(cid)

const get = (cid: string) => {
  const value = cache.get(cid)
  if (!value) {
    return null
  }

  return async function* () {
    yield value
  }
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
  cache.set(cid, buffer)
}

export const downloadCache = {
  has,
  get,
  set,
}

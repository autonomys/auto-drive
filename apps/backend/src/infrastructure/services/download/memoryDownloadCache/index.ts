import { LRUCache } from 'lru-cache'
import { bufferToAsyncIterable } from '@autonomys/asynchronous'
import { AwaitIterable } from 'interface-store'
import { config } from '../../../../config.js'
import { DownloadServiceOptions } from '@auto-drive/models'

const maxCacheSize = config.memoryDownloadCache.maxCacheSize

const cache = new LRUCache<string, Buffer>({
  maxSize: maxCacheSize,
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
    value.subarray(
      byteRange[0],
      byteRange[1] !== undefined ? byteRange[1] + 1 : undefined,
    ),
  )
}

const set = async (
  cid: string,
  value: AwaitIterable<Buffer>,
): Promise<void> => {
  const chunks: Buffer[] = []
  let size = 0
  // Drain to the end even once the object is too large to cache: the download
  // service forks the response from this stream, and the fork only advances as
  // fast as its slowest branch.
  for await (const chunk of value) {
    size += chunk.length
    if (size > maxCacheSize) {
      chunks.length = 0
      continue
    }
    chunks.push(chunk)
  }

  if (size > 0 && size <= maxCacheSize) {
    cache.set(cid, Buffer.concat(chunks, size), {
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

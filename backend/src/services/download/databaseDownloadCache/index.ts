import { AwaitIterable } from 'interface-store'
import { downloadCacheFilePartsRepository } from '../../../repositories/cache/fileParts.js'
import { registryRepository } from '../../../repositories/cache/registry.js'
import { asyncByChunk } from '../../../utils/async.js'

const DEFAULT_CHUNK_SIZE = 10 * 1024 ** 2 // 10MB
const DEFAULT_MAX_CACHE_SIZE = BigInt(10 * 1024 ** 3) // 10GB

const config = {
  chunkSize: process.env.DATABASE_DOWNLOAD_CACHE_CHUNK_SIZE
    ? parseInt(process.env.DATABASE_DOWNLOAD_CACHE_CHUNK_SIZE)
    : DEFAULT_CHUNK_SIZE,
  maxCacheSize: process.env.DATABASE_DOWNLOAD_CACHE_MAX_SIZE
    ? BigInt(process.env.DATABASE_DOWNLOAD_CACHE_MAX_SIZE)
    : DEFAULT_MAX_CACHE_SIZE,
}

const internalSet = async function* (
  cid: string,
  data: AwaitIterable<Buffer>,
  size: bigint,
): AsyncIterable<Buffer> {
  await registryRepository.addEntry({
    cid,
    size: size.toString(),
    last_accessed_at: new Date(),
  })

  let i = 0
  for await (const chunk of asyncByChunk(data, config.chunkSize)) {
    await downloadCacheFilePartsRepository.addFilePart({
      cid,
      index: i,
      data: chunk,
    })
    yield chunk
    i++
  }
}

const updateCacheSize = async (size: bigint) => {
  let currentSize = await registryRepository.getTotalSize()
  const newSize = currentSize + size
  if (newSize > config.maxCacheSize) {
    const entries = await registryRepository.getEntriesSortedByLastAccessedAt()
    for (const entry of entries) {
      if (currentSize <= config.maxCacheSize) {
        break
      }
      await registryRepository.removeEntries([entry.cid])
      currentSize -= BigInt(entry.size)
    }
  }
}

const set = async (
  cid: string,
  data: AwaitIterable<Buffer>,
  size: bigint,
): Promise<AwaitIterable<Buffer>> => {
  if (await has(cid)) {
    return data
  }

  await updateCacheSize(size)
  return internalSet(cid, data, size)
}

const get = async function* (cid: string): AsyncIterable<Buffer> {
  const entry = await registryRepository.getEntry(cid)
  if (!entry) {
    return null
  }

  const fileParts = await downloadCacheFilePartsRepository.getFilePartCount(cid)
  for (let i = 0; i < fileParts; i++) {
    const filePart = await downloadCacheFilePartsRepository.getFilePart(cid, i)
    yield filePart.data
  }
}

const has = async (cid: string) => {
  const entry = await registryRepository.getEntry(cid)

  return !!entry
}

export const databaseDownloadCache = {
  set,
  get,
  has,
}

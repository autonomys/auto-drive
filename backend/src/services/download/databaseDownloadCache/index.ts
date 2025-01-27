import { AwaitIterable } from 'interface-store'
import { downloadCacheFilePartsRepository } from '../../../repositories/cache/fileParts.js'
import { registryRepository } from '../../../repositories/cache/registry.js'
import { asyncByChunk } from '../../../utils/async.js'
import { config } from '../../../config.js'

const internalSet = async function* (
  cid: string,
  data: AwaitIterable<Buffer>,
  size: bigint,
): AsyncIterable<Buffer> {
  let i = 0
  for await (const chunk of asyncByChunk(
    data,
    config.databaseDownloadCache.chunkSize,
  )) {
    await downloadCacheFilePartsRepository.addFilePart({
      cid,
      index: i,
      data: chunk,
    })
    yield chunk
    i++
  }

  if (i > 0) {
    await registryRepository.addEntry({
      cid,
      size: size.toString(),
      last_accessed_at: new Date(),
    })
  }
}

const updateCacheSize = async (size: bigint) => {
  let currentSize = BigInt(await registryRepository.getTotalSize())
  const newSize = currentSize + BigInt(size)
  if (newSize > config.databaseDownloadCache.maxCacheSize) {
    const entries = await registryRepository.getEntriesSortedByLastAccessedAt()
    for (const entry of entries) {
      if (currentSize <= config.databaseDownloadCache.maxCacheSize) {
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

const has = async (cid: string): Promise<boolean> => {
  const entry = await registryRepository.getEntry(cid)

  return Boolean(entry).valueOf()
}

export const clear = async () => {
  await downloadCacheFilePartsRepository.clear()
  await registryRepository.clear()
}

export const databaseDownloadCache = {
  set,
  get,
  has,
  clear,
}

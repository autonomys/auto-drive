import { Stream } from 'stream'
import { Keyv } from 'keyv'

export interface BaseCacheConfig {
  pathPartitions: number
  cacheDir: string
  stores: Keyv<FileResponse>[]
}

export interface FileCache {
  get: (cid: string) => Promise<Buffer | Stream | null>
  set: (cid: string, data: Buffer | Stream) => Promise<void>
  remove: (cid: string) => Promise<void>
}

export type FileResponse = {
  data: AsyncIterable<Buffer>
  mimeType?: string
  filename?: string
  size?: bigint
  encoding?: string
}

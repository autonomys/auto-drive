import { createFileCache } from './index.js'
import { ensureDirectoryExists } from '../../../utils/fs.js'
import path from 'path'
import { config } from '../../../config'
import { Keyv } from 'keyv'
import KeyvSqlite from '@keyvhq/sqlite'
import { LRUCache } from 'lru-cache'

export const fsCache = createFileCache({
  cacheDir: ensureDirectoryExists(path.join(config.cacheDir, 'files')),
  pathPartitions: 3,
  stores: [
    new Keyv({
      serialize: (value) => JSON.stringify(value),
      store: new LRUCache<string, string>({
        maxSize: config.cacheMaxSize,
        maxEntrySize: Number.MAX_SAFE_INTEGER,
        sizeCalculation: (value) => {
          const { value: parsedValue } = JSON.parse(value)
          return Number(parsedValue?.size ?? 0)
        },
      }),
    }),
    new Keyv({
      store: new KeyvSqlite({
        uri: path.join(ensureDirectoryExists(config.cacheDir), 'files.sqlite'),
      }),
      ttl: config.cacheTtl,
      serialize: (value) => JSON.stringify(value),
    }),
  ],
})

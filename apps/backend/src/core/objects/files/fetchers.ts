import { Readable } from 'stream'
import {
  composeNodesDataAsFileReadable,
  retrieveAndReassembleFolderAsZip,
} from './nodeComposer.js'
import { NodesUseCases } from '../nodes.js'
import { FileGateway } from '../../../infrastructure/services/dsn/fileGateway/index.js'
import { ObjectUseCases } from '../object.js'
import { withTimeout } from '../../../shared/utils/timeout.js'
import { config } from '../../../config.js'
import { createLogger } from '../../../infrastructure/drivers/logger.js'
import PizZip from 'pizzip'
import { ChunkNotFoundError } from '../../../errors/index.js'

const logger = createLogger('useCases:objects:files:fetchers')

const GATEWAY_TIMEOUT_MS = config.filesGateway.fetchTimeoutMs

export interface ObjectFetcher {
  fetchFile(cid: string): Promise<Readable>
  fetchNode(cid: string): Promise<Buffer>
  // Resolve a whole batch in one go, in the order requested. Throws on the
  // first CID that cannot be resolved, like fetchNode. The composer fetches
  // chunks 100 at a time, and for the database fetcher that is one statement
  // instead of 200 (see NodesUseCases.getChunksData).
  fetchNodes(cids: string[]): Promise<Buffer[]>
}

export const DBObjectFetcher: ObjectFetcher = {
  async fetchFile(cid: string): Promise<Readable> {
    const getMetadataResult = await ObjectUseCases.getMetadata(cid)
    if (getMetadataResult.isErr()) {
      throw new Error(`Object not found: cid=${cid}`)
    }
    const metadata = getMetadataResult.value

    if (metadata.type === 'file') {
      return composeNodesDataAsFileReadable({
        fetcher: DBObjectFetcher,
        chunks: metadata.chunks.map((chunk) => chunk.cid),
        concurrentChunks: 100,
      })
    }

    return retrieveAndReassembleFolderAsZip(new PizZip(), cid)
  },
  async fetchNode(cid: string): Promise<Buffer> {
    const [chunkData] = await DBObjectFetcher.fetchNodes([cid])
    return chunkData
  },
  async fetchNodes(cids: string[]): Promise<Buffer[]> {
    const chunks = await NodesUseCases.getChunksData(cids)

    return cids.map((cid) => {
      const chunkData = chunks.get(cid)
      if (!chunkData) {
        throw new ChunkNotFoundError(cid)
      }
      return chunkData
    })
  },
}

export const FileGatewayObjectFetcher: ObjectFetcher = {
  async fetchFile(cid: string): Promise<Readable> {
    const getMetadataResult = await ObjectUseCases.getMetadata(cid)
    if (getMetadataResult.isErr()) {
      throw new Error(`Object not found: cid=${cid}`)
    }
    const metadata = getMetadataResult.value

    if (metadata.type === 'file') {
      logger.debug(
        'Fetching file from gateway cid=%s (timeout=%dms)',
        cid,
        GATEWAY_TIMEOUT_MS,
      )
      return withTimeout(
        FileGateway.getFile(cid),
        GATEWAY_TIMEOUT_MS,
        `FileGateway.getFile(${cid})`,
      )
    }

    return retrieveAndReassembleFolderAsZip(new PizZip(), cid)
  },
  async fetchNode(cid: string): Promise<Buffer> {
    const node = await withTimeout(
      FileGateway.getNode(cid),
      GATEWAY_TIMEOUT_MS,
      `FileGateway.getNode(${cid})`,
    )
    return Buffer.from(node)
  },
  // No batch endpoint on the gateway, so this stays a fan-out. It is not the
  // path issue #815 lives on — the gateway is only used for archived objects,
  // whose nodes are long past migration.
  async fetchNodes(cids: string[]): Promise<Buffer[]> {
    return Promise.all(cids.map((cid) => FileGatewayObjectFetcher.fetchNode(cid)))
  },
}

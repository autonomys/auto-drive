import { Readable } from 'stream'
import {
  composeNodesDataAsFileReadable,
  retrieveAndReassembleFolderAsZip,
} from './nodeComposer.js'
import { NodesUseCases } from '../nodes.js'
import { FileGateway } from '../../../infrastructure/services/dsn/fileGateway/index.js'
import { ObjectUseCases } from '../object.js'
import PizZip from 'pizzip'

export interface ObjectFetcher {
  fetchFile(cid: string): Promise<Readable>
  fetchNode(cid: string): Promise<Buffer>
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
    const chunkData = await NodesUseCases.getChunkData(cid)
    if (!chunkData) {
      throw new Error(`Chunk not found: cid=${cid}`)
    }
    return chunkData
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
      return FileGateway.getFile(cid)
    }

    return retrieveAndReassembleFolderAsZip(new PizZip(), cid)
  },
  async fetchNode(cid: string): Promise<Buffer> {
    const node = await FileGateway.getNode(cid)
    return Buffer.from(node)
  },
}

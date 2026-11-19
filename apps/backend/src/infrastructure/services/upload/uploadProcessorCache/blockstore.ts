import {
  cidToString,
  decodeIPLDNodeData,
  MetadataType,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { Pair } from 'interface-blockstore'
import { AwaitIterable } from 'interface-store'
import { CID } from 'multiformats/cid'
import pg from 'pg'
import {
  blockstoreRepository,
  ChunkEntry,
} from '../../../repositories/uploads/index.js'
import { BaseBlockstore } from 'blockstore-core'

// The blockstore row for an encoded node. `data` is a view of the node's bytes,
// not a copy.
export const toBlockstoreRow = (cid: CID, block: Uint8Array): ChunkEntry => {
  const decoded = decodeIPLDNodeData(block)
  return {
    cid: cidToString(cid),
    node_type: decoded.type,
    node_size: decoded.size ?? BigInt(0).valueOf(),
    data: Buffer.from(block.buffer, block.byteOffset, block.byteLength),
  }
}

export class MultiUploadBlockstore implements BaseBlockstore {
  constructor(
    private readonly uploadId: string,
    private readonly client?: pg.PoolClient,
  ) {}

  async *getFilteredMany(nodeType: MetadataType): AwaitIterable<CID> {
    const cids = await blockstoreRepository.getCidsByType(
      this.uploadId,
      nodeType,
      this.client,
    )

    for (const cid of cids) {
      yield stringToCid(cid)
    }
  }

  async has(key: Pair['cid']): Promise<boolean> {
    return blockstoreRepository.hasCid(
      this.uploadId,
      cidToString(key),
      this.client,
    )
  }

  async put(cid: Pair['cid'], data: Uint8Array): Promise<Pair['cid']> {
    const row = toBlockstoreRow(cid, data)
    await blockstoreRepository.addBlockstoreEntry(
      this.uploadId,
      row.cid,
      row.node_type,
      row.node_size,
      row.data,
      this.client,
    )

    return cid
  }

  async *putMany(source: AwaitIterable<Pair>): AwaitIterable<Pair['cid']> {
    for await (const pair of source) {
      yield await this.put(pair.cid, pair.block)
    }
  }

  async get(key: Pair['cid']): Promise<Uint8Array> {
    const block = await blockstoreRepository.getByCid(
      this.uploadId,
      cidToString(key),
      this.client,
    )

    return Buffer.from(block!.data)
  }

  async *getMany(source: AwaitIterable<Pair['cid']>): AwaitIterable<Pair> {
    for await (const key of source) {
      yield {
        cid: key,
        block: await this.get(key),
      }
    }
  }

  async delete(key: Pair['cid']): Promise<void> {
    await blockstoreRepository.deleteBlockstoreEntry(
      this.uploadId,
      cidToString(key),
      this.client,
    )
  }

  async *deleteMany(
    source: AwaitIterable<Pair['cid']>,
  ): AwaitIterable<Pair['cid']> {
    for await (const key of source) {
      await this.delete(key)
      yield key
    }
  }

  async *getAll(): AwaitIterable<Pair> {
    const blocks = await blockstoreRepository.getBlockstoreEntries(
      this.uploadId,
      this.client,
    )

    for (const block of blocks) {
      yield {
        cid: stringToCid(block.cid),
        block: Buffer.from(block.data),
      }
    }
  }

  async *getAllKeys(): AsyncIterable<Pair['cid']> {
    const blocks = await blockstoreRepository.getBlockstoreEntriesWithoutData(
      this.uploadId,
      this.client,
    )

    for (const block of blocks) {
      yield stringToCid(block.cid)
    }
  }

  async getSize(key: Pair['cid']): Promise<bigint> {
    const block = await blockstoreRepository.getByCIDWithoutData(
      this.uploadId,
      cidToString(key),
      this.client,
    )

    return BigInt(block!.node_size).valueOf()
  }
}

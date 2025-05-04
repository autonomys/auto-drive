import {
  cidToString,
  decodeIPLDNodeData,
  MetadataType,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { Pair } from 'interface-blockstore'
import { AwaitIterable } from 'interface-store'
import { CID } from 'multiformats/cid'
import { blockstoreRepository } from '../../../repositories/uploads/index.js'
import { BaseBlockstore } from 'blockstore-core'

export class MultiUploadBlockstore implements BaseBlockstore {
  constructor(private readonly uploadId: string) {}

  async *getFilteredMany(nodeType: MetadataType): AwaitIterable<CID> {
    const blockstore = await blockstoreRepository.findMany({
      where: {
        upload_id: this.uploadId,
        node_type: nodeType,
      },
    })

    for (const entry of blockstore) {
      yield stringToCid(entry.cid)
    }
  }

  async has(key: Pair['cid']): Promise<boolean> {
    const block = await blockstoreRepository.findFirst({
      where: {
        upload_id: this.uploadId,
        cid: cidToString(key),
      },
    })

    return block !== null
  }

  async put(cid: Pair['cid'], data: Uint8Array): Promise<Pair['cid']> {
    const decodedData = decodeIPLDNodeData(data)
    const size = decodedData.size ?? BigInt(0).valueOf()

    await blockstoreRepository.create({
      data: {
        upload_id: this.uploadId,
        cid: cidToString(cid),
        node_type: decodedData.type,
        node_size: size,
        data: Buffer.from(data),
      },
    })

    return cid
  }

  async *putMany(source: AwaitIterable<Pair>): AwaitIterable<Pair['cid']> {
    for await (const pair of source) {
      yield await this.put(pair.cid, pair.block)
    }
  }

  async get(key: Pair['cid']): Promise<Uint8Array> {
    const block = await blockstoreRepository.findFirst({
      where: {
        upload_id: this.uploadId,
        cid: cidToString(key),
      },
    })

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
    await blockstoreRepository.delete({
      where: {
        upload_id: this.uploadId,
        cid: cidToString(key),
        upload_id_cid: {
          upload_id: this.uploadId,
          cid: cidToString(key),
        },
      },
    })
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
    const blocks = await blockstoreRepository.findMany({
      where: {
        upload_id: this.uploadId,
      },
    })

    for (const block of blocks) {
      yield {
        cid: stringToCid(block.cid),
        block: Buffer.from(block.data),
      }
    }
  }

  async *getAllKeys(): AsyncIterable<Pair['cid']> {
    const blocks = await blockstoreRepository.findMany({
      select: {
        cid: true,
      },
      where: {
        upload_id: this.uploadId,
      },
    })

    for (const block of blocks) {
      yield stringToCid(block.cid)
    }
  }

  async getSize(key: Pair['cid']): Promise<bigint> {
    const block = await blockstoreRepository.findFirst({
      select: {
        node_size: true,
      },
      where: {
        upload_id: this.uploadId,
        cid: cidToString(key),
      },
    })

    return BigInt(block!.node_size).valueOf()
  }
}

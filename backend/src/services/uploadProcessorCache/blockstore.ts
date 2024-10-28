import {
  cidToString,
  decodeIPLDNodeData,
  MetadataType,
  stringToCid,
} from "@autonomys/auto-drive";
import { Pair } from "interface-blockstore";
import { AbortOptions, AwaitIterable } from "interface-store";
import { CID } from "multiformats/cid";
import { blockstoreRepository } from "../../repositories/uploads/index.js";
import { BaseBlockstore } from "blockstore-core";

export class MultiUploadBlockstore implements BaseBlockstore {
  constructor(private uploadId: string) {}

  async *getFilteredMany(
    nodeType: MetadataType,
    options?: AbortOptions
  ): AwaitIterable<CID> {
    const blockstore = await blockstoreRepository.getByType(
      this.uploadId,
      nodeType
    );

    for (const entry of blockstore) {
      yield stringToCid(entry.cid);
    }
  }

  async has(key: Pair["cid"], options?: AbortOptions): Promise<boolean> {
    const block = await blockstoreRepository.getByCid(
      this.uploadId,
      cidToString(key)
    );

    return block !== null;
  }

  async put(
    cid: Pair["cid"],
    data: Uint8Array,
    options?: AbortOptions
  ): Promise<Pair["cid"]> {
    const decodedData = decodeIPLDNodeData(data);
    const size = decodedData.size ?? 0;

    await blockstoreRepository.addBlockstoreEntry(
      this.uploadId,
      cidToString(cid),
      decodedData.type,
      size,
      Buffer.from(data)
    );

    return cid;
  }

  async *putMany(
    source: AwaitIterable<Pair>,
    options?: AbortOptions
  ): AwaitIterable<Pair["cid"]> {
    for await (const pair of source) {
      yield await this.put(pair.cid, pair.block, options);
    }
  }

  async get(key: Pair["cid"], options?: AbortOptions): Promise<Uint8Array> {
    const block = await blockstoreRepository.getByCid(
      this.uploadId,
      cidToString(key)
    );

    return Buffer.from(block!.data);
  }

  async *getMany(
    source: AwaitIterable<Pair["cid"]>,
    options?: AbortOptions
  ): AwaitIterable<Pair> {
    for await (const key of source) {
      yield { cid: key, block: await this.get(key, options) };
    }
  }

  async delete(key: Pair["cid"], options?: AbortOptions): Promise<void> {
    await blockstoreRepository.deleteBlockstoreEntry(
      this.uploadId,
      cidToString(key)
    );
  }

  async *deleteMany(
    source: AwaitIterable<Pair["cid"]>,
    options?: AbortOptions
  ): AwaitIterable<Pair["cid"]> {
    for await (const key of source) {
      await this.delete(key, options);
    }
  }

  async *getAll(options?: AbortOptions): AwaitIterable<Pair> {
    const blocks = await blockstoreRepository.getBlockstoreEntries(
      this.uploadId
    );

    for (const block of blocks) {
      yield { cid: stringToCid(block.cid), block: Buffer.from(block.data) };
    }
  }

  async *getAllKeys(options?: AbortOptions): AsyncIterable<Pair["cid"]> {
    const blocks = await blockstoreRepository.getBlockstoreEntriesWithoutData(
      this.uploadId
    );

    console.log(`Found ${blocks.length} blocks in ${this.uploadId}`);

    for (const block of blocks) {
      yield stringToCid(block.cid);
    }
  }

  async getSize(key: Pair["cid"]): Promise<number> {
    const block = await blockstoreRepository.getByCIDWithoutData(
      this.uploadId,
      cidToString(key)
    );

    return block!.node_size;
  }
}

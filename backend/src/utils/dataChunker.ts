import type { CID } from "multiformats";
import { hashData } from "./dataHasher.js";

const MAX_CHUNK_SIZE = 1024 * 64; // 64 KB

export type Chunk = {
  cid: CID;
  size: number;
  data: Buffer;
};

export const chunkData = (data: Buffer): Chunk[] =>
  Array.from({ length: Math.ceil(data.length / MAX_CHUNK_SIZE) }, (_, i) => {
    const start = i * MAX_CHUNK_SIZE;
    const end = Math.min((i + 1) * MAX_CHUNK_SIZE, data.length);
    const chunkData = Buffer.from(data.buffer.slice(start, end));

    return {
      cid: hashData(chunkData),
      size: chunkData.length,
      data: chunkData,
    };
  });

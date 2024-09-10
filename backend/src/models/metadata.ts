import { IPLDDag, cidOfNode, cidToString } from "@autonomys/auto-drive";
import { ChunkInfo } from "./chunkInfo";
import { PBNode, createNode, decode, encode } from "@ipld/dag-pb";

export type Metadata = {
  dataCid: string;
  filename?: string;
  mimeType?: string;
  totalSize: number;
  totalChunks: number;
  chunks: ChunkInfo[];
};

export const fileMetadata = (
  dag: IPLDDag,
  totalSize: number,
  filename?: string,
  mimeType?: string
): Metadata => {
  return {
    dataCid: cidToString(dag.headCID),
    filename,
    mimeType,
    totalSize,
    totalChunks: dag.nodes.size,
    chunks: Array.from(dag.nodes.values()).map((chunk) => ({
      cid: cidToString(cidOfNode(chunk)),
      size: chunk.Data?.length ?? 0,
      data: Buffer.from(chunk.Data ?? new Uint8Array()),
    })),
  };
};

export const metadataFromBytes = (bytes: Buffer): Metadata => {
  return JSON.parse(
    Buffer.from(decode(bytes).Data ?? new Uint8Array()).toString()
  );
};

export const metadataToBytes = (metadata: Metadata): Buffer => {
  return Buffer.from(
    encode(createNode(Buffer.from(JSON.stringify(metadata)), []))
  );
};

import { IPLDDag, cidOfNode, cidToString } from "@autonomys/auto-drive";
import { ChunkInfo } from "./chunkInfo";

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

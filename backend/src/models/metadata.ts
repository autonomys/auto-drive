import { IPLDDag, cidOfNode, cidToString } from "@autonomys/auto-drive";
import { ChunkInfo } from "./chunkInfo";
import { createNode, decode, encode } from "@ipld/dag-pb";

interface ChildrenMetadata {
  type: "folder" | "file";
  name?: string;
  cid: string;
  totalSize: number;
}

type FolderMetadata = {
  type: "folder";
  dataCid: string;
  name?: string;
  totalSize: number;
  totalFiles: number;
  children: ChildrenMetadata[];
};

type FileMetadata = {
  type: "file";
  dataCid: string;
  name?: string;
  mimeType?: string;
  totalSize: number;
  totalChunks: number;
  chunks: ChunkInfo[];
};

export type Metadata = FileMetadata | FolderMetadata;

export const fileMetadata = (
  dag: IPLDDag,
  totalSize: number,
  name?: string,
  mimeType?: string
): FileMetadata => {
  return {
    type: "file",
    dataCid: cidToString(dag.headCID),
    name,
    mimeType,
    totalSize,
    totalChunks: dag.nodes.size,
    chunks: Array.from(dag.nodes.values()).map((chunk) => ({
      cid: cidToString(cidOfNode(chunk)),
      size: chunk.Data?.length ?? 0,
    })),
  };
};

export const folderMetadata = (
  cid: string,
  children: Metadata[]
): FolderMetadata => {
  return {
    dataCid: cid,
    totalSize: children.reduce((acc, child) => acc + child.totalSize, 0),
    totalFiles: children.length,
    children: children.map((child) => ({
      name: child.name,
      type: child.type,
      cid: child.dataCid,
      totalSize: child.totalSize,
    })),
    type: "folder",
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

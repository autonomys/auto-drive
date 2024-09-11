export interface ChunkInfo {
  size: number;
  cid: string;
}

type FolderMetadata = {
  type: "folder";
  dataCid: string;
  name?: string;
  totalSize: number;
  totalFiles: number;
  children: string[];
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

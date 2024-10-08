import { OffchainMetadata } from "@autonomys/auto-drive";

export interface UploadedObjectMetadata {
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
  owners: Owner[];
}

export interface UploadStatus {
  uploadedNodes: number;
  totalNodes: number;
  minimumBlockDepth: number | null;
}

export interface Owner {
  handle: string;
  role: "admin" | "viewer";
}
